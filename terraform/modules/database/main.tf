resource "aws_db_subnet_group" "main" {
  name       = "vaultdao-db-subnet-group"
  subnet_ids = var.database_subnet_ids

  tags = {
    Name = "vaultdao-db-subnet-group"
  }
}

resource "aws_security_group" "rds" {
  name   = "vaultdao-rds-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.database_allowed_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "vaultdao-rds-sg"
  }
}

resource "random_password" "db_password" {
  length  = 32
  special = true
}

resource "aws_db_instance" "main" {
  identifier     = "vaultdao-db-${var.environment}"
  engine         = var.engine
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage = var.allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.database_name
  username = var.username
  password = random_password.db_password.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az               = var.multi_az
  backup_retention_days  = var.backup_retention_days
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"
  copy_tags_to_snapshot  = true

  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = "vaultdao-db-final-snapshot-${var.environment}"

  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = {
    Name = "vaultdao-db-${var.environment}"
  }
}

resource "aws_secretsmanager_secret" "db_password" {
  name = "vaultdao/database/${var.environment}/password"

  tags = {
    Name = "vaultdao-db-password-${var.environment}"
  }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db_password.result
}
