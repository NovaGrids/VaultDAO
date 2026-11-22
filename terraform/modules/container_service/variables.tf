variable "environment" {
  description = "Deployment environment (staging | production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

# Network inputs from networking module
variable "vpc_id" {
  description = "VPC ID."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the ALB."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ECS Fargate tasks."
  type        = list(string)
}

variable "alb_sg_id" {
  description = "ALB security group ID from the networking module."
  type        = string
}

variable "app_sg_id" {
  description = "App security group ID from the networking module."
  type        = string
}

# Secrets
variable "read_secrets_policy_arn" {
  description = "IAM policy ARN from the secrets module allowing tasks to read Secrets Manager."
  type        = string
}

variable "secret_injections" {
  description = <<EOT
List of secrets to inject as container environment variables.
Each entry maps an environment variable name to a Secrets Manager secret ARN
(optionally with a JSON key suffix, e.g., arn:...:secret:name::json-key::).
EOT
  type = list(object({
    env_var_name = string
    secret_arn   = string
  }))
  default = []
}

# Container
variable "container_image" {
  description = "Full ECR image URI (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/vaultdao/backend:sha-abc). Leave empty to use the ECR repo created by this module with :latest."
  type        = string
  default     = ""
}

variable "app_port" {
  description = "Port the backend application listens on."
  type        = number
  default     = 8787
}

variable "task_cpu" {
  description = "ECS task CPU units (256, 512, 1024, 2048, 4096)."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "ECS task memory in MiB."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Initial desired task count."
  type        = number
  default     = 2
}

variable "min_count" {
  description = "Minimum task count for auto scaling."
  type        = number
  default     = 2
}

variable "max_count" {
  description = "Maximum task count for auto scaling."
  type        = number
  default     = 10
}

# ALB / TLS
variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS termination on the ALB."
  type        = string
}

# Logging
variable "log_retention_days" {
  description = "CloudWatch log retention in days for ECS task logs."
  type        = number
  default     = 30
}
