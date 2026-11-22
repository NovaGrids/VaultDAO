variable "aws_region" {
  description = "AWS region for staging resources."
  type        = string
  default     = "us-east-1"
}

variable "app_port" {
  description = "Port the backend application listens on."
  type        = number
  default     = 8787
}

variable "stellar_contract_id" {
  description = "Deployed Soroban contract ID on testnet."
  type        = string
  default     = ""
}

variable "cors_origin" {
  description = "Allowed CORS origin for the staging API."
  type        = string
  default     = "https://staging.app.vaultdao.io"
}

variable "container_image" {
  description = "Backend container image URI. Leave empty to build from ECR with :latest."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the staging ALB (must cover staging.app.vaultdao.io or the staging domain)."
  type        = string
}

variable "github_org" {
  description = "GitHub organisation name."
  type        = string
  default     = "NovaGrids"
}

variable "github_repo" {
  description = "GitHub repository name."
  type        = string
  default     = "VaultDAO"
}
