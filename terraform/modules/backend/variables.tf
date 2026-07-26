variable "environment" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "container_image" {
  type = string
}

variable "container_port" {
  type = number
}

variable "replica_count" {
  type = number
}

variable "cpu_requests" {
  type = string
}

variable "memory_requests" {
  type = string
}

variable "cpu_limits" {
  type = string
}

variable "memory_limits" {
  type = string
}

variable "log_level" {
  type = string
}

variable "rpc_endpoint" {
  type      = string
  sensitive = true
}

variable "rpc_backup_endpoints" {
  type      = list(string)
  sensitive = true
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "redis_url" {
  type      = string
  sensitive = true
}
