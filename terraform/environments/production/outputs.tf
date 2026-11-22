output "alb_dns_name" {
  description = "Production ALB DNS name. Point your CNAME / Route 53 alias here."
  value       = module.container_service.alb_dns_name
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing production images."
  value       = module.container_service.ecr_repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = module.container_service.ecs_cluster_name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = module.container_service.ecs_service_name
}

output "ci_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC deployments to production."
  value       = module.ci_oidc.role_arn
}

output "postgres_secret_arn" {
  description = "Secrets Manager ARN for Postgres credentials."
  value       = module.postgres.secret_arn
}

output "redis_secret_arn" {
  description = "Secrets Manager ARN for Redis AUTH token."
  value       = module.redis.secret_arn
}

output "vpc_id" {
  description = "Production VPC ID."
  value       = module.networking.vpc_id
}

output "nat_public_ips" {
  description = "NAT Gateway public IPs (allowlist in Stellar RPC providers if needed)."
  value       = module.networking.nat_public_ips
}

output "log_group_name" {
  description = "CloudWatch log group for ECS backend containers."
  value       = module.container_service.log_group_name
}
