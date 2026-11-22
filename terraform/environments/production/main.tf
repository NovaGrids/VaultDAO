##############################################################################
# VaultDAO — Production Environment
#
# Production-hardened configuration:
#   - Multi-AZ Postgres and Redis
#   - Dedicated FARGATE capacity (no Spot)
#   - Longer backup retention
#   - Deletion protection enabled
#   - Minimum 2 ECS tasks for HA
#   - GitHub Environment-scoped OIDC (requires GitHub Environment "production")
##############################################################################

terraform {
  required_version = ">= 1.5"

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

  backend "s3" {
    bucket         = "vaultdao-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "vaultdao-terraform-lock"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = "production"
      Project     = "VaultDAO"
      ManagedBy   = "Terraform"
    }
  }
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

module "networking" {
  source = "../../modules/networking"

  environment             = "production"
  vpc_cidr                = "10.0.0.0/16"
  az_count                = 3
  app_port                = var.app_port
  flow_log_retention_days = 90
}

# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------

module "postgres" {
  source = "../../modules/postgres"

  environment           = "production"
  data_subnet_ids       = module.networking.data_subnet_ids
  postgres_sg_id        = module.networking.postgres_sg_id
  db_name               = "vaultdao"
  engine_version        = "15.4"
  instance_class        = "db.t3.medium"
  allocated_storage     = 100
  multi_az              = true
  backup_retention_days = 30
  deletion_protection   = true
}

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

module "redis" {
  source = "../../modules/redis"

  environment        = "production"
  data_subnet_ids    = module.networking.data_subnet_ids
  redis_sg_id        = module.networking.redis_sg_id
  engine_version     = "7.0"
  node_type          = "cache.t4g.small"
  num_cache_clusters = 2  # Multi-AZ automatic failover enabled
  snapshot_retention_days = 7
}

# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------

module "secrets" {
  source = "../../modules/secrets"

  environment               = "production"
  stellar_contract_id       = var.stellar_contract_id
  stellar_network           = "mainnet"
  stellar_rpc_url           = "https://soroban-mainnet.stellar.org"
  cors_origin               = var.cors_origin
  event_polling_enabled     = true
  event_polling_interval_ms = 10000

  extra_secret_arns = [
    module.postgres.secret_arn,
    module.redis.secret_arn,
  ]
}

# ---------------------------------------------------------------------------
# Container Service
# ---------------------------------------------------------------------------

module "container_service" {
  source = "../../modules/container_service"

  environment        = "production"
  vpc_id             = module.networking.vpc_id
  public_subnet_ids  = module.networking.public_subnet_ids
  private_subnet_ids = module.networking.private_subnet_ids
  alb_sg_id          = module.networking.alb_sg_id
  app_sg_id          = module.networking.app_sg_id
  app_port           = var.app_port

  read_secrets_policy_arn = module.secrets.read_secrets_policy_arn

  secret_injections = [
    { env_var_name = "DATABASE_URL",        secret_arn = "${module.postgres.secret_arn}:connection_string::" },
    { env_var_name = "REDIS_URL",           secret_arn = "${module.redis.secret_arn}:connection_url::" },
    { env_var_name = "JWT_SECRET",          secret_arn = module.secrets.jwt_secret_arn },
    { env_var_name = "CONTRACT_ID",         secret_arn = "${module.secrets.app_config_secret_arn}:CONTRACT_ID::" },
    { env_var_name = "STELLAR_NETWORK",     secret_arn = "${module.secrets.app_config_secret_arn}:STELLAR_NETWORK::" },
    { env_var_name = "STELLAR_RPC_URL",     secret_arn = "${module.secrets.app_config_secret_arn}:STELLAR_RPC_URL::" },
  ]

  container_image     = var.container_image
  task_cpu            = 1024
  task_memory         = 2048
  desired_count       = 2  # minimum 2 for HA
  min_count           = 2
  max_count           = 10
  acm_certificate_arn = var.acm_certificate_arn
  log_retention_days  = 90
}

# ---------------------------------------------------------------------------
# CI OIDC
# ---------------------------------------------------------------------------

module "ci_oidc" {
  source = "../../modules/ci_oidc"

  environment  = "production"
  github_org   = var.github_org
  github_repo  = var.github_repo

  # Production: use GitHub Environment scoped claims (no branch override).
  # Requires a GitHub Environment named "production" with required reviewers.
  allowed_branches = null

  ecr_repository_arns = ["arn:aws:ecr:${var.aws_region}:*:repository/vaultdao/backend"]
  ecs_service_arns    = [module.container_service.ecs_cluster_arn, "${module.container_service.ecs_cluster_arn}/*"]
  ecs_task_role_arns  = [
    module.container_service.task_execution_role_arn,
    module.container_service.task_role_arn,
  ]
}
