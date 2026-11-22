variable "environment" {
  description = "Deployment environment (staging | production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

variable "github_org" {
  description = "GitHub organisation name (e.g. 'NovaGrids')."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (e.g. 'VaultDAO')."
  type        = string
}

variable "allowed_branches" {
  description = <<EOT
List of branches allowed to assume the CI role. When set, the trust policy
restricts to 'repo:<org>/<repo>:ref:refs/heads/<branch>' claims.
Leave null to use GitHub Environment-scoped claims instead (recommended for
production — requires a GitHub Environment named after var.environment).
EOT
  type        = list(string)
  default     = null
}

variable "ecr_repository_arns" {
  description = "ECR repository ARNs the CI role may push images to."
  type        = list(string)
}

variable "ecs_service_arns" {
  description = "ECS service ARNs the CI role may update."
  type        = list(string)
}

variable "ecs_task_role_arns" {
  description = "Task execution role and task role ARNs that ECS may be passed when registering a new task definition."
  type        = list(string)
}
