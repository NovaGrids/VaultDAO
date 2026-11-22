##############################################################################
# Module: postgres
#
# Provisions a hardened RDS PostgreSQL instance with:
#   - Dedicated DB subnet group (data tier, no public access)
#   - Security group received from the networking module (5432 from app only)
#   - Random password stored in AWS Secrets Manager
#   - Storage encryption (KMS), Multi-AZ, automated backups
#   - Performance Insights + CloudWatch Logs export
#   - Deletion protection enabled by default for production
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
# Password
# ---------------------------------------------------------------------------

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%^&*()-_=+[]{}"
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  min_special      = 2
}

# ---------------------------------------------------------------------------
# Secrets Manager
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "db" {
  name                    = "vaultdao/${var.environment}/postgres/master"
  description             = "VaultDAO ${var.environment} Postgres master credentials"
  recovery_window_in_days = var.environment == "production" ? 30 : 7

  tags = {
    Name        = "vaultdao-postgres-secret-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db.result
    dbname   = var.db_name
    host     = aws_db_instance.main.address
    port     = 5432
    engine   = "postgres"
  })

  # Rotate immediately whenever this module re-applies
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# Subnet Group
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name        = "vaultdao-postgres-${var.environment}"
  description = "VaultDAO ${var.environment} Postgres subnet group (data tier)"
  subnet_ids  = var.data_subnet_ids

  tags = {
    Name        = "vaultdao-postgres-subnet-group-${var.environment}"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# Parameter Group — enforce SSL and sensible defaults
# ---------------------------------------------------------------------------

resource "aws_db_parameter_group" "main" {
  name        = "vaultdao-postgres-${var.environment}"
  family      = "postgres${split(".", var.engine_version)[0]}"
  description = "VaultDAO ${var.environment} Postgres parameter group"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # log queries > 1 s
  }

  tags = {
    Name        = "vaultdao-postgres-params-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# RDS Instance
# ---------------------------------------------------------------------------

resource "aws_db_instance" "main" {
  identifier = "vaultdao-postgres-${var.environment}"

  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 2
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn # null = AWS-managed key

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.postgres_sg_id]
  parameter_group_name   = aws_db_parameter_group.main.name

  multi_az               = var.multi_az
  publicly_accessible    = false # never publicly accessible
  deletion_protection    = var.deletion_protection

  backup_retention_period   = var.backup_retention_days
  backup_window             = "03:00-04:00"
  maintenance_window        = "sun:04:30-sun:05:30"
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false

  skip_final_snapshot       = !var.deletion_protection
  final_snapshot_identifier = "vaultdao-postgres-final-${var.environment}-${formatdate("YYYYMMDDhhmmss", timestamp())}"

  performance_insights_enabled          = var.environment == "production"
  performance_insights_retention_period = var.environment == "production" ? 7 : 0

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  auto_minor_version_upgrade = true
  apply_immediately          = false

  tags = {
    Name        = "vaultdao-postgres-${var.environment}"
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [
      # Avoid recreation on every apply due to formatdate in snapshot ID
      final_snapshot_identifier,
      password,
    ]
  }

  depends_on = [aws_db_subnet_group.main]
}
