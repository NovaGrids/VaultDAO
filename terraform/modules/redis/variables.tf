variable "environment" {
  description = "Deployment environment (staging | production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

variable "data_subnet_ids" {
  description = "Data-tier subnet IDs from the networking module. No public subnets."
  type        = list(string)
}

variable "redis_sg_id" {
  description = "Security group ID from the networking module restricting Redis to app tier only."
  type        = string
}

variable "engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.0"
}

variable "node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.small"
}

variable "num_cache_clusters" {
  description = "Number of cache clusters (nodes). >= 2 enables Multi-AZ automatic failover."
  type        = number
  default     = 2
  validation {
    condition     = var.num_cache_clusters >= 1
    error_message = "num_cache_clusters must be >= 1."
  }
}

variable "snapshot_retention_days" {
  description = "Number of days to retain Redis snapshots."
  type        = number
  default     = 5
}
