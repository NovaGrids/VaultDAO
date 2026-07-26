resource "aws_elasticache_subnet_group" "main" {
  name       = "vaultdao-redis-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "vaultdao-redis-subnet-group"
  }
}

resource "aws_security_group" "redis" {
  name   = "vaultdao-redis-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "vaultdao-redis-sg"
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_description = "VaultDAO Redis cluster"
  replication_group_id          = "vaultdao-redis-${var.environment}"
  engine                        = var.engine
  engine_version                = var.engine_version
  node_type                     = var.node_type
  num_cache_clusters            = var.num_cache_nodes
  parameter_group_name          = var.parameter_group_name
  port                          = 6379
  automatic_failover_enabled    = var.automatic_failover
  multi_az_enabled              = var.num_cache_nodes > 1 ? true : false

  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_engine.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
  }

  tags = {
    Name = "vaultdao-redis-${var.environment}"
  }

  depends_on = [
    aws_elasticache_subnet_group.main,
    aws_cloudwatch_log_group.redis_slow,
    aws_cloudwatch_log_group.redis_engine
  ]
}

resource "aws_cloudwatch_log_group" "redis_slow" {
  name              = "/aws/elasticache/vaultdao-redis-${var.environment}/slow-log"
  retention_in_days = 7

  tags = {
    Name = "vaultdao-redis-slow-log-${var.environment}"
  }
}

resource "aws_cloudwatch_log_group" "redis_engine" {
  name              = "/aws/elasticache/vaultdao-redis-${var.environment}/engine-log"
  retention_in_days = 7

  tags = {
    Name = "vaultdao-redis-engine-log-${var.environment}"
  }
}
