variable "environment" {
  description = "Deployment environment (staging | production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'."
  }
}

variable "stellar_contract_id" {
  description = "Deployed Soroban contract ID."
  type        = string
  default     = ""
}

variable "stellar_network" {
  description = "Stellar network identifier (testnet | mainnet)."
  type        = string
  default     = "mainnet"
  validation {
    condition     = contains(["testnet", "mainnet"], var.stellar_network)
    error_message = "stellar_network must be 'testnet' or 'mainnet'."
  }
}

variable "stellar_rpc_url" {
  description = "Soroban RPC endpoint URL."
  type        = string
  default     = "https://soroban-mainnet.stellar.org"
}

variable "cors_origin" {
  description = "Allowed CORS origin for the backend API."
  type        = string
  default     = "https://app.vaultdao.io"
}

variable "event_polling_enabled" {
  description = "Whether the backend event poller is enabled."
  type        = bool
  default     = true
}

variable "event_polling_interval_ms" {
  description = "Event polling interval in milliseconds."
  type        = number
  default     = 10000
}

variable "extra_secret_arns" {
  description = "Additional secret ARNs (e.g., from postgres and redis modules) to include in the read policy."
  type        = list(string)
  default     = []
}

variable "kms_key_arn" {
  description = "KMS key ARN used to encrypt secrets. Required if secrets use a CMK."
  type        = string
  default     = null
}
