variable "environment" {
  description = "Deployment environment (staging | production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

variable "vpc_cidr" {
  description = "IPv4 CIDR for the VPC. Must be /16 to accommodate the auto-calculated subnets."
  type        = string
  default     = "10.0.0.0/16"
  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid CIDR block."
  }
}

variable "az_count" {
  description = "Number of Availability Zones to span. Capped at the AZs available in the region."
  type        = number
  default     = 2
  validation {
    condition     = var.az_count >= 2 && var.az_count <= 4
    error_message = "az_count must be between 2 and 4."
  }
}

variable "app_port" {
  description = "Port the backend application listens on."
  type        = number
  default     = 8787
}

variable "flow_log_retention_days" {
  description = "CloudWatch log retention in days for VPC Flow Logs."
  type        = number
  default     = 30
}
