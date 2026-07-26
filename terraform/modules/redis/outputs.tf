output "endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "port" {
  value = 6379
}

output "connection_string" {
  value = "redis://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
}

output "replication_group_id" {
  value = aws_elasticache_replication_group.main.id
}

output "security_group_id" {
  value = aws_security_group.redis.id
}
