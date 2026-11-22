output "db_instance_id" {
  description = "RDS instance identifier."
  value       = aws_db_instance.main.id
}

output "db_address" {
  description = "RDS instance hostname."
  value       = aws_db_instance.main.address
}

output "db_port" {
  description = "RDS instance port."
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Database name."
  value       = aws_db_instance.main.db_name
}

output "secret_arn" {
  description = "Secrets Manager secret ARN containing host, port, dbname, username and password."
  value       = aws_secretsmanager_secret.db.arn
}

output "secret_name" {
  description = "Secrets Manager secret name for use in ECS task definitions."
  value       = aws_secretsmanager_secret.db.name
}

# The connection string is sensitive; use secret_arn in ECS task definitions
# instead of injecting it directly.
output "connection_string" {
  description = "PostgreSQL connection string. Mark as sensitive; prefer secret_arn for ECS."
  value       = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${var.db_name}?sslmode=require"
  sensitive   = true
}
