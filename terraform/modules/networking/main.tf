##############################################################################
# Module: networking
#
# Creates a hardened VPC with:
#   - Public subnets (ALB only)
#   - Private subnets (ECS tasks, Redis, Postgres)
#   - NAT Gateways per AZ for HA egress
#   - VPC Flow Logs to CloudWatch
#   - Separate security groups for each tier (ALB → app → redis/postgres)
#
# No resource in this module opens Redis (6379) or Postgres (5432)
# to the public internet. Those ports are only reachable from the
# app_sg security group, which is itself limited to ALB egress.
##############################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  az_count = min(length(data.aws_availability_zones.available.names), var.az_count)
  azs      = slice(data.aws_availability_zones.available.names, 0, local.az_count)
}

# ---------------------------------------------------------------------------
# VPC
# ---------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "vaultdao-vpc-${var.environment}"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# Subnets
# ---------------------------------------------------------------------------

resource "aws_subnet" "public" {
  count                   = local.az_count
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false # ECS tasks use private subnets; ALB is here

  tags = {
    Name        = "vaultdao-public-${local.azs[count.index]}-${var.environment}"
    Tier        = "public"
    Environment = var.environment
  }
}

resource "aws_subnet" "private" {
  count             = local.az_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + local.az_count)
  availability_zone = local.azs[count.index]

  tags = {
    Name        = "vaultdao-private-${local.azs[count.index]}-${var.environment}"
    Tier        = "private"
    Environment = var.environment
  }
}

resource "aws_subnet" "data" {
  count             = local.az_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + local.az_count * 2)
  availability_zone = local.azs[count.index]

  tags = {
    Name        = "vaultdao-data-${local.azs[count.index]}-${var.environment}"
    Tier        = "data"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# Internet Gateway
# ---------------------------------------------------------------------------

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name        = "vaultdao-igw-${var.environment}"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# NAT Gateways (one per AZ for HA)
# ---------------------------------------------------------------------------

resource "aws_eip" "nat" {
  count  = local.az_count
  domain = "vpc"

  tags = {
    Name        = "vaultdao-nat-eip-${local.azs[count.index]}-${var.environment}"
    Environment = var.environment
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_nat_gateway" "main" {
  count         = local.az_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = {
    Name        = "vaultdao-nat-${local.azs[count.index]}-${var.environment}"
    Environment = var.environment
  }

  depends_on = [aws_internet_gateway.main]
}

# ---------------------------------------------------------------------------
# Route Tables
# ---------------------------------------------------------------------------

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name        = "vaultdao-rt-public-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_route_table_association" "public" {
  count          = local.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = local.az_count
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }

  tags = {
    Name        = "vaultdao-rt-private-${local.azs[count.index]}-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_route_table_association" "private" {
  count          = local.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Data subnets have no route to the internet — isolated tier.
resource "aws_route_table" "data" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name        = "vaultdao-rt-data-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_route_table_association" "data" {
  count          = local.az_count
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}

# ---------------------------------------------------------------------------
# VPC Flow Logs
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "flow_logs" {
  name              = "/aws/vpc/vaultdao-${var.environment}/flow-logs"
  retention_in_days = var.flow_log_retention_days

  tags = {
    Name        = "vaultdao-vpc-flow-logs-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_iam_role" "flow_logs" {
  name = "vaultdao-vpc-flow-logs-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "flow_logs" {
  name = "vaultdao-vpc-flow-logs-policy-${var.environment}"
  role = aws_iam_role.flow_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams"
      ]
      Resource = "*"
    }]
  })
}

resource "aws_flow_log" "main" {
  vpc_id          = aws_vpc.main.id
  traffic_type    = "ALL"
  iam_role_arn    = aws_iam_role.flow_logs.arn
  log_destination = aws_cloudwatch_log_group.flow_logs.arn

  tags = {
    Name        = "vaultdao-flow-log-${var.environment}"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# Security Groups
# ---------------------------------------------------------------------------

# ALB — accepts HTTPS from the internet, no direct database access.
resource "aws_security_group" "alb" {
  name        = "vaultdao-alb-sg-${var.environment}"
  description = "ALB: accepts inbound HTTPS; forwards to app tier only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP redirect from internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Egress is restricted to the app tier — the ALB never talks to data
  # stores directly.
  egress {
    description     = "Forward to backend app tier"
    from_port       = var.app_port
    to_port         = var.app_port
    protocol        = "tcp"
    self            = false
    # actual reference to app_sg added after both are created via
    # aws_security_group_rule resources below
    cidr_blocks     = []
    security_groups = []
  }

  tags = {
    Name        = "vaultdao-alb-sg-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# App (ECS tasks)
resource "aws_security_group" "app" {
  name        = "vaultdao-app-sg-${var.environment}"
  description = "ECS backend tasks: accepts traffic from ALB only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name        = "vaultdao-app-sg-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# App ingress from ALB only
resource "aws_security_group_rule" "app_ingress_alb" {
  type                     = "ingress"
  description              = "From ALB to app port"
  from_port                = var.app_port
  to_port                  = var.app_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
  security_group_id        = aws_security_group.app.id
}

# App egress to Postgres
resource "aws_security_group_rule" "app_egress_postgres" {
  type                     = "egress"
  description              = "App to Postgres"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.postgres.id
  security_group_id        = aws_security_group.app.id
}

# App egress to Redis
resource "aws_security_group_rule" "app_egress_redis" {
  type                     = "egress"
  description              = "App to Redis"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.redis.id
  security_group_id        = aws_security_group.app.id
}

# App egress to internet (Stellar RPC, AWS APIs via NAT)
resource "aws_security_group_rule" "app_egress_https" {
  type        = "egress"
  description = "App to internet via NAT (Stellar RPC, AWS APIs)"
  from_port   = 443
  to_port     = 443
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
  security_group_id = aws_security_group.app.id
}

# ALB egress to app (rule-based so we can reference app sg)
resource "aws_security_group_rule" "alb_egress_app" {
  type                     = "egress"
  description              = "ALB to backend app"
  from_port                = var.app_port
  to_port                  = var.app_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
  security_group_id        = aws_security_group.alb.id
}

# Redis — private, no public access, only from app tier.
resource "aws_security_group" "redis" {
  name        = "vaultdao-redis-sg-${var.environment}"
  description = "Redis: port 6379 from app tier only — never exposed publicly"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name        = "vaultdao-redis-sg-${var.environment}"
    Environment = var.environment
    # Explicit tag reinforcing the no-public-access intent for auditors
    SecurityNote = "No public Redis — 6379 open to app-sg only"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "redis_ingress_app" {
  type                     = "ingress"
  description              = "Redis from app tier only"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
  security_group_id        = aws_security_group.redis.id
}

# Postgres
resource "aws_security_group" "postgres" {
  name        = "vaultdao-postgres-sg-${var.environment}"
  description = "Postgres: port 5432 from app tier only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name        = "vaultdao-postgres-sg-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "postgres_ingress_app" {
  type                     = "ingress"
  description              = "Postgres from app tier only"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
  security_group_id        = aws_security_group.postgres.id
}
