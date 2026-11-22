variable "aws_region" {
  description = "AWS region for production resources."
  type        = string
  default     = "us-east-1"
}

variable "app_port" {
  description = "Port the backend application listens on."
  type        = number
  default     = 8787
}

variable "stellar_contract_id" {
  description = "Deployed Soroban contract ID on mainnet."
  type        = string
}

variable "cors_origin" {
  description = "Allowed CORS origin for the production API."
  type        = string
  default     = "https://app.vaultdao.io"
}

variable "container_image" {
  description = "Backend container image URI for production. Must be an immutable tag (not :latest)."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the production ALB (must cover app.vaultdao.io)."
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
