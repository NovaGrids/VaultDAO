output "jwt_secret_arn" {
  description = "Secrets Manager ARN for the JWT signing secret."
  value       = aws_secretsmanager_secret.jwt.arn
}

output "jwt_secret_name" {
  description = "Secrets Manager name for the JWT signing secret."
  value       = aws_secretsmanager_secret.jwt.name
}

output "app_config_secret_arn" {
  description = "Secrets Manager ARN for the application config bundle."
  value       = aws_secretsmanager_secret.app_config.arn
}

output "app_config_secret_name" {
  description = "Secrets Manager name for the application config bundle."
  value       = aws_secretsmanager_secret.app_config.name
}

output "read_secrets_policy_arn" {
  description = "IAM policy ARN to attach to the ECS task execution role for reading secrets."
  value       = aws_iam_policy.read_secrets.arn
}
