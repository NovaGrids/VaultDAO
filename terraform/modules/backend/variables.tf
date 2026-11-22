variable "aws_region" {
  description = "AWS region for backend resources"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "bucket_name" {
  description = "Name of the S3 bucket for Terraform state"
  type        = string
}

variable "dynamodb_table_name" {
  description = "Name of the DynamoDB table for state locking"
  type        = string
}

variable "admin_kms_key_arn" {
  description = "ARN of the AWS KMS CMK used to protect the admin contract key"
  type        = string
}

variable "admin_secret_arn" {
  description = "ARN of the AWS Secrets Manager secret holding the admin contract key reference"
  type        = string
}

variable "admin_secret_name" {
  description = "Name of the AWS Secrets Manager secret holding the admin contract key reference"
  type        = string
}