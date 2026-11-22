output "primary_endpoint" {
  description = "Primary Redis endpoint address."
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "reader_endpoint" {
  description = "Redis reader endpoint for read-scaling."
  value       = aws_elasticache_replication_group.main.reader_endpoint_address
}

output "port" {
  description = "Redis port (always 6379)."
  value       = 6379
}

output "replication_group_id" {
  description = "ElastiCache replication group ID."
  value       = aws_elasticache_replication_group.main.id
}

output "secret_arn" {
  description = "Secrets Manager secret ARN containing the AUTH token and connection details."
  value       = aws_secretsmanager_secret.redis_auth.arn
}

output "secret_name" {
  description = "Secrets Manager secret name for use in ECS task definitions."
  value       = aws_secretsmanager_secret.redis_auth.name
}

# Use secret_arn in ECS task definitions rather than this value directly.
output "connection_url" {
  description = "Redis TLS connection URL. Sensitive — prefer secret_arn for ECS."
  value       = "rediss://:${random_password.auth_token.result}@${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
  sensitive   = true
}
