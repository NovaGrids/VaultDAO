variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (production, staging, development)"
  type        = string
  validation {
    condition     = contains(["production", "staging", "development"], var.environment)
    error_message = "Environment must be production, staging, or development."
  }
}

variable "terraform_state_bucket" {
  description = "S3 bucket name for Terraform remote state"
  type        = string
  default     = "vaultdao-terraform-state"
}

variable "terraform_state_key" {
  description = "S3 key for Terraform state file"
  type        = string
  default     = "production/terraform.tfstate"
}

variable "terraform_state_region" {
  description = "AWS region for Terraform state bucket"
  type        = string
  default     = "us-east-1"
}

variable "terraform_lock_table" {
  description = "DynamoDB table name for Terraform state locking"
  type        = string
  default     = "terraform-lock"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDR blocks"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDR blocks"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "database_subnet_cidrs" {
  description = "Database subnet CIDR blocks"
  type        = list(string)
  default     = ["10.0.20.0/24", "10.0.21.0/24"]
}

variable "kubernetes_version" {
  description = "Kubernetes version"
  type        = string
  default     = "1.28"
}

variable "cluster_public_access_cidrs" {
  description = "List of CIDR blocks allowed to access the EKS cluster endpoint"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "node_instance_types" {
  description = "EC2 instance types for EKS nodes"
  type        = list(string)
  default     = ["t3.large"]
}

variable "node_group_desired_size" {
  description = "Desired number of worker nodes"
  type        = number
  default     = 3
}

variable "node_group_max_size" {
  description = "Maximum number of worker nodes"
  type        = number
  default     = 10
}

variable "node_group_min_size" {
  description = "Minimum number of worker nodes"
  type        = number
  default     = 2
}

# Backend Service Variables
variable "backend_image" {
  description = "Docker image for backend service"
  type        = string
  default     = "vaultdao/backend:latest"
}

variable "backend_port" {
  description = "Port for backend service"
  type        = number
  default     = 3000
}

variable "backend_replica_count" {
  description = "Number of backend replicas"
  type        = number
  default     = 3
}

variable "backend_cpu_requests" {
  description = "CPU request for backend container"
  type        = string
  default     = "500m"
}

variable "backend_memory_requests" {
  description = "Memory request for backend container"
  type        = string
  default     = "512Mi"
}

variable "backend_cpu_limits" {
  description = "CPU limit for backend container"
  type        = string
  default     = "1000m"
}

variable "backend_memory_limits" {
  description = "Memory limit for backend container"
  type        = string
  default     = "1Gi"
}

variable "log_level" {
  description = "Log level for services"
  type        = string
  default     = "info"
  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.log_level)
    error_message = "Log level must be debug, info, warn, or error."
  }
}

# Database Variables
variable "db_engine" {
  description = "Database engine"
  type        = string
  default     = "postgres"
}

variable "db_engine_version" {
  description = "Database engine version"
  type        = string
  default     = "15.3"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for RDS"
  type        = bool
  default     = true
}

variable "db_backup_retention_days" {
  description = "Number of days to retain database backups"
  type        = number
  default     = 30
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "vaultdao"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "postgres"
  sensitive   = true
}

variable "db_skip_final_snapshot" {
  description = "Skip final snapshot on deletion"
  type        = bool
  default     = false
}

# Redis Variables
variable "redis_engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.0"
}

variable "redis_node_type" {
  description = "Redis node type"
  type        = string
  default     = "cache.t3.medium"
}

variable "redis_num_cache_nodes" {
  description = "Number of Redis cache nodes"
  type        = number
  default     = 2
}

variable "redis_parameter_group_name" {
  description = "Redis parameter group name"
  type        = string
  default     = "default.redis7"
}

variable "redis_automatic_failover" {
  description = "Enable automatic failover for Redis"
  type        = bool
  default     = true
}

# RPC Pool Variables
variable "rpc_providers" {
  description = "List of RPC providers with endpoints"
  type = list(object({
    name     = string
    endpoint = string
    priority = number
  }))
  default = [
    {
      name     = "infura"
      endpoint = "https://mainnet.infura.io/v3/"
      priority = 1
    },
    {
      name     = "alchemy"
      endpoint = "https://eth-mainnet.alchemyapi.io/v2/"
      priority = 2
    }
  ]
}

variable "primary_rpc_provider_idx" {
  description = "Index of primary RPC provider"
  type        = number
  default     = 0
}

# Monitoring Variables
variable "prometheus_retention" {
  description = "Prometheus data retention period"
  type        = string
  default     = "15d"
}

variable "grafana_admin_password" {
  description = "Grafana admin password"
  type        = string
  sensitive   = true
  default     = ""
}

variable "alert_email" {
  description = "Email address for alerting"
  type        = string
  default     = "alerts@vaultdao.io"
}

variable "slack_webhook_url" {
  description = "Slack webhook URL for alerts"
  type        = string
  sensitive   = true
  default     = ""
}
