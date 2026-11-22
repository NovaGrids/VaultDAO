##############################################################################
# VaultDAO — Staging Environment
#
# Wires together the reusable modules with staging-appropriate sizing:
#   - Smaller instances (cost savings)
#   - Multi-AZ disabled on Redis for staging
#   - FARGATE_SPOT for ECS (cheaper)
#   - Shorter backup retention
#   - Deletion protection off (easy teardown)
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
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "vaultdao-terraform-lock"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = "staging"
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

  environment             = "staging"
  vpc_cidr                = "10.1.0.0/16"
  az_count                = 2
  app_port                = var.app_port
  flow_log_retention_days = 14
}

# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------

module "postgres" {
  source = "../../modules/postgres"

  environment           = "staging"
  data_subnet_ids       = module.networking.data_subnet_ids
  postgres_sg_id        = module.networking.postgres_sg_id
  db_name               = "vaultdao_staging"
  engine_version        = "15.4"
  instance_class        = "db.t3.micro"
  allocated_storage     = 20
  multi_az              = false # single-AZ for staging
  backup_retention_days = 3
  deletion_protection   = false
}

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

module "redis" {
  source = "../../modules/redis"

  environment        = "staging"
  data_subnet_ids    = module.networking.data_subnet_ids
  redis_sg_id        = module.networking.redis_sg_id
  engine_version     = "7.0"
  node_type          = "cache.t4g.micro"
  num_cache_clusters = 1 # single node for staging
  snapshot_retention_days = 1
}

# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------

module "secrets" {
  source = "../../modules/secrets"

  environment               = "staging"
  stellar_contract_id       = var.stellar_contract_id
  stellar_network           = "testnet"
  stellar_rpc_url           = "https://soroban-testnet.stellar.org"
  cors_origin               = var.cors_origin
  event_polling_enabled     = true
  event_polling_interval_ms = 15000

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

  environment        = "staging"
  vpc_id             = module.networking.vpc_id
  public_subnet_ids  = module.networking.public_subnet_ids
  private_subnet_ids = module.networking.private_subnet_ids
  alb_sg_id          = module.networking.alb_sg_id
  app_sg_id          = module.networking.app_sg_id
  app_port           = var.app_port

  read_secrets_policy_arn = module.secrets.read_secrets_policy_arn

  # Inject secrets as environment variables — no plaintext in task definition
  secret_injections = [
    { env_var_name = "DATABASE_URL",        secret_arn = "${module.postgres.secret_arn}:connection_string::" },
    { env_var_name = "REDIS_URL",           secret_arn = "${module.redis.secret_arn}:connection_url::" },
    { env_var_name = "JWT_SECRET",          secret_arn = module.secrets.jwt_secret_arn },
    { env_var_name = "CONTRACT_ID",         secret_arn = "${module.secrets.app_config_secret_arn}:CONTRACT_ID::" },
    { env_var_name = "STELLAR_NETWORK",     secret_arn = "${module.secrets.app_config_secret_arn}:STELLAR_NETWORK::" },
    { env_var_name = "STELLAR_RPC_URL",     secret_arn = "${module.secrets.app_config_secret_arn}:STELLAR_RPC_URL::" },
  ]

  container_image     = var.container_image
  task_cpu            = 256
  task_memory         = 512
  desired_count       = 1
  min_count           = 1
  max_count           = 3
  acm_certificate_arn = var.acm_certificate_arn
  log_retention_days  = 14
}

# ---------------------------------------------------------------------------
# CI OIDC
# ---------------------------------------------------------------------------

module "ci_oidc" {
  source = "../../modules/ci_oidc"

  environment  = "staging"
  github_org   = var.github_org
  github_repo  = var.github_repo

  # Staging: allow deploy from main and develop branches
  allowed_branches = ["main", "develop"]

  ecr_repository_arns = [module.container_service.ecr_repository_url != "" ? "arn:aws:ecr:${var.aws_region}:*:repository/vaultdao/backend" : "arn:aws:ecr:${var.aws_region}:*:repository/vaultdao/backend"]
  ecs_service_arns    = [module.container_service.ecs_cluster_arn, "${module.container_service.ecs_cluster_arn}/*"]
  ecs_task_role_arns  = [
    module.container_service.task_execution_role_arn,
    module.container_service.task_role_arn,
  ]
}
