output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets (ALB placement)."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets (ECS task placement)."
  value       = aws_subnet.private[*].id
}

output "data_subnet_ids" {
  description = "IDs of the data-tier subnets (RDS and ElastiCache)."
  value       = aws_subnet.data[*].id
}

output "alb_sg_id" {
  description = "Security group ID for the Application Load Balancer."
  value       = aws_security_group.alb.id
}

output "app_sg_id" {
  description = "Security group ID for ECS backend tasks."
  value       = aws_security_group.app.id
}

output "redis_sg_id" {
  description = "Security group ID for ElastiCache Redis (6379 from app only)."
  value       = aws_security_group.redis.id
}

output "postgres_sg_id" {
  description = "Security group ID for RDS Postgres (5432 from app only)."
  value       = aws_security_group.postgres.id
}

output "nat_gateway_ids" {
  description = "NAT Gateway IDs, one per AZ."
  value       = aws_nat_gateway.main[*].id
}

output "nat_public_ips" {
  description = "Elastic IPs associated with NAT Gateways (useful for firewall allowlisting)."
  value       = aws_eip.nat[*].public_ip
}
