##############################################################################
# Module: redis
#
# Provisions an ElastiCache Serverless Redis cluster with:
#   - Data-tier subnets only (no public subnets)
#   - Security group received from networking module (6379 from app only)
#   - Encryption at rest and in transit (TLS required)
#   - AUTH token stored in Secrets Manager
#   - Multi-AZ replication group for HA
#   - Slow-query and engine-event logs to CloudWatch
#
# Redis is NEVER accessible from a public subnet or the internet.
##############################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

# ---------------------------------------------------------------------------
# AUTH token
# ---------------------------------------------------------------------------

resource "random_password" "auth_token" {
  length           = 64
  special          = false # ElastiCache AUTH tokens must be alphanumeric + select specials
  override_special = "!&#$^<>-"
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name                    = "vaultdao/${var.environment}/redis/auth-token"
  description             = "VaultDAO ${var.environment} Redis AUTH token"
  recovery_window_in_days = var.environment == "production" ? 30 : 7

  tags = {
    Name        = "vaultdao-redis-auth-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id = aws_secretsmanager_secret.redis_auth.id
  secret_string = jsonencode({
    auth_token = random_password.auth_token.result
    host       = aws_elasticache_replication_group.main.primary_endpoint_address
    port       = 6379
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# Subnet Group — data tier only
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "main" {
  name        = "vaultdao-redis-${var.environment}"
  description = "VaultDAO ${var.environment} Redis subnet group (data tier, no public subnets)"
  subnet_ids  = var.data_subnet_ids

  tags = {
    Name        = "vaultdao-redis-subnet-group-${var.environment}"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# Parameter Group
# ---------------------------------------------------------------------------

resource "aws_elasticache_parameter_group" "main" {
  name        = "vaultdao-redis-${var.environment}"
  family      = "redis${split(".", var.engine_version)[0]}"
  description = "VaultDAO ${var.environment} Redis parameter group"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  tags = {
    Name        = "vaultdao-redis-params-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# CloudWatch Log Groups
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "slow_log" {
  name              = "/aws/elasticache/vaultdao-${var.environment}/slow-log"
  retention_in_days = 14

  tags = {
    Name        = "vaultdao-redis-slow-log-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_log_group" "engine_log" {
  name              = "/aws/elasticache/vaultdao-${var.environment}/engine-log"
  retention_in_days = 7

  tags = {
    Name        = "vaultdao-redis-engine-log-${var.environment}"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# Replication Group
# ---------------------------------------------------------------------------

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "vaultdao-${var.environment}"
  description          = "VaultDAO ${var.environment} Redis HA cluster"

  engine         = "redis"
  engine_version = var.engine_version
  node_type      = var.node_type
  port           = 6379

  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.num_cache_clusters > 1
  multi_az_enabled           = var.num_cache_clusters > 1

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [var.redis_sg_id]

  parameter_group_name = aws_elasticache_parameter_group.main.name

  # Security: encryption at rest and in transit
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.auth_token.result

  # Maintenance
  apply_immediately          = false
  auto_minor_version_upgrade = true
  maintenance_window         = "sun:05:00-sun:06:00"
  snapshot_retention_limit   = var.snapshot_retention_days
  snapshot_window            = "04:00-05:00"

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.slow_log.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.engine_log.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
  }

  tags = {
    Name        = "vaultdao-redis-${var.environment}"
    Environment = var.environment
    # Explicit tag for security audits — no public Redis access
    SecurityNote = "Port 6379 open to app-sg only; no public access"
  }

  depends_on = [
    aws_elasticache_subnet_group.main,
    aws_cloudwatch_log_group.slow_log,
    aws_cloudwatch_log_group.engine_log,
  ]
}
