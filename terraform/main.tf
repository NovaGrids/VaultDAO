terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.20"
    }
  }

  backend "s3" {
    bucket         = "vaultdao-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-lock"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "VaultDAO"
      ManagedBy   = "Terraform"
    }
  }
}

provider "kubernetes" {
  host                   = aws_eks_cluster.main.endpoint
  cluster_ca_certificate = base64decode(aws_eks_cluster.main.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.main.token
}

data "aws_eks_cluster_auth" "main" {
  name = aws_eks_cluster.main.name
}

# VPC and Networking
module "vpc" {
  source = "./modules/vpc"

  environment = var.environment
  vpc_cidr    = var.vpc_cidr
  region      = var.aws_region

  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  database_subnet_cidrs = var.database_subnet_cidrs
}

# EKS Cluster
resource "aws_eks_cluster" "main" {
  name            = "vaultdao-${var.environment}"
  role_arn        = aws_iam_role.eks_cluster.arn
  version         = var.kubernetes_version

  vpc_config {
    subnet_ids              = concat(module.vpc.public_subnet_ids, module.vpc.private_subnet_ids)
    endpoint_private_access = true
    endpoint_public_access  = true
    public_access_cidrs     = var.cluster_public_access_cidrs
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]

  depends_on = [aws_iam_role_policy_attachment.eks_cluster_policy]

  tags = {
    Name = "vaultdao-eks-${var.environment}"
  }
}

resource "aws_iam_role" "eks_cluster" {
  name = "vaultdao-eks-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks_cluster.name
}

# EKS Node Group
resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "vaultdao-${var.environment}-nodes"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = module.vpc.private_subnet_ids

  scaling_config {
    desired_size = var.node_group_desired_size
    max_size     = var.node_group_max_size
    min_size     = var.node_group_min_size
  }

  instance_types = var.node_instance_types

  tags = {
    Name = "vaultdao-eks-nodes-${var.environment}"
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_nodes_policy,
    aws_iam_role_policy_attachment.eks_cni_policy,
    aws_iam_role_policy_attachment.eks_container_registry_policy
  ]
}

resource "aws_iam_role" "eks_nodes" {
  name = "vaultdao-eks-nodes-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eks_nodes_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_iam_role_policy_attachment" "eks_cni_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.eks_nodes.name
}

resource "aws_iam_role_policy_attachment" "eks_container_registry_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.eks_nodes.name
}

# Backend Server Module
module "backend" {
  source = "./modules/backend"

  environment            = var.environment
  cluster_name           = aws_eks_cluster.main.name
  container_image        = var.backend_image
  container_port         = var.backend_port
  replica_count          = var.backend_replica_count
  cpu_requests           = var.backend_cpu_requests
  memory_requests        = var.backend_memory_requests
  cpu_limits             = var.backend_cpu_limits
  memory_limits          = var.backend_memory_limits
  log_level              = var.log_level
  rpc_endpoint           = module.rpc_pool.primary_endpoint
  rpc_backup_endpoints   = module.rpc_pool.backup_endpoints
  database_url           = module.database.connection_string
  redis_url              = module.redis.connection_string

  depends_on = [
    aws_eks_node_group.main,
    module.database,
    module.redis,
    module.rpc_pool
  ]
}

# Database Module (PostgreSQL)
module "database" {
  source = "./modules/database"

  environment           = var.environment
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  database_subnet_ids   = module.vpc.database_subnet_ids
  engine                = var.db_engine
  engine_version        = var.db_engine_version
  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
  database_name         = var.db_name
  username              = var.db_username
  skip_final_snapshot   = var.db_skip_final_snapshot

  depends_on = [module.vpc]
}

# Redis Cache Module
module "redis" {
  source = "./modules/redis"

  environment          = var.environment
  vpc_id               = module.vpc.vpc_id
  private_subnet_ids   = module.vpc.private_subnet_ids
  engine               = "redis"
  engine_version       = var.redis_engine_version
  node_type            = var.redis_node_type
  num_cache_nodes      = var.redis_num_cache_nodes
  parameter_group_name = var.redis_parameter_group_name
  automatic_failover   = var.redis_automatic_failover

  depends_on = [module.vpc]
}

# RPC Pool Module
module "rpc_pool" {
  source = "./modules/rpc_pool"

  environment          = var.environment
  vpc_id               = module.vpc.vpc_id
  private_subnet_ids   = module.vpc.private_subnet_ids
  rpc_providers        = var.rpc_providers
  primary_provider_idx = var.primary_rpc_provider_idx
}

# Monitoring Infrastructure Module
module "monitoring" {
  source = "./modules/monitoring"

  environment          = var.environment
  cluster_name         = aws_eks_cluster.main.name
  cluster_endpoint     = aws_eks_cluster.main.endpoint
  cluster_ca_cert      = aws_eks_cluster.main.certificate_authority[0].data
  prometheus_retention = var.prometheus_retention
  grafana_admin_password = var.grafana_admin_password
  alert_email          = var.alert_email
  slack_webhook_url    = var.slack_webhook_url

  depends_on = [aws_eks_node_group.main]
}

# Load Balancer for Backend
resource "aws_lb" "backend" {
  name               = "vaultdao-backend-lb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.lb.id]
  subnets            = module.vpc.public_subnet_ids

  tags = {
    Name = "vaultdao-backend-lb-${var.environment}"
  }
}

resource "aws_security_group" "lb" {
  name   = "vaultdao-lb-sg-${var.environment}"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "vaultdao-lb-sg-${var.environment}"
  }
}

# Outputs
output "eks_cluster_endpoint" {
  value = aws_eks_cluster.main.endpoint
}

output "eks_cluster_arn" {
  value = aws_eks_cluster.main.arn
}

output "load_balancer_dns" {
  value = aws_lb.backend.dns_name
}

output "database_endpoint" {
  value = module.database.endpoint
}

output "redis_endpoint" {
  value = module.redis.endpoint
}

output "monitoring_grafana_url" {
  value = module.monitoring.grafana_url
}
