variable "environment" {
  description = "Deployment environment (staging | production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

variable "data_subnet_ids" {
  description = "Data-tier subnet IDs from the networking module."
  type        = list(string)
}

variable "postgres_sg_id" {
  description = "Security group ID from the networking module that restricts Postgres to app tier only."
  type        = string
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "vaultdao"
}

variable "db_username" {
  description = "Master username for the RDS instance."
  type        = string
  default     = "vaultdao_admin"
  sensitive   = true
}

variable "engine_version" {
  description = "PostgreSQL engine version."
  type        = string
  default     = "15.4"
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.medium"
}

variable "allocated_storage" {
  description = "Initial allocated storage in GiB. max_allocated_storage is set to 2×."
  type        = number
  default     = 50
}

variable "multi_az" {
  description = "Enable Multi-AZ standby for automatic failover."
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "Number of days to retain automated backups."
  type        = number
  default     = 14
}

variable "deletion_protection" {
  description = "Enable deletion protection. Recommended true for production."
  type        = bool
  default     = true
}

variable "kms_key_arn" {
  description = "KMS key ARN for storage encryption. Leave null to use the AWS-managed RDS key."
  type        = string
  default     = null
}
