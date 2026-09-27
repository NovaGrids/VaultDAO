variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "rpc_providers" {
  type = list(object({
    name     = string
    endpoint = string
    priority = number
  }))
}

variable "primary_provider_idx" {
  type = number
}
