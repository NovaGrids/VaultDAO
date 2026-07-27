variable "environment" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "cluster_endpoint" {
  type = string
}

variable "cluster_ca_cert" {
  type      = string
  sensitive = true
}

variable "prometheus_retention" {
  type = string
}

variable "grafana_admin_password" {
  type      = string
  sensitive = true
}

variable "alert_email" {
  type = string
}

variable "slack_webhook_url" {
  type      = string
  sensitive = true
}
