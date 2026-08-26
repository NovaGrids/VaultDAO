# VaultDAO Terraform Backend Bootstrap
#
# This directory contains a standalone Terraform configuration used to bootstrap
# the remote state backend (S3 bucket + DynamoDB lock table).
#
# Run this ONCE before configuring the remote backend in the root terraform/ config.

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "backend" {
  source             = "../modules/backend"
  aws_region         = var.aws_region
  environment        = var.environment
  bucket_name        = var.bucket_name
  dynamodb_table_name = var.dynamodb_table_name
}
