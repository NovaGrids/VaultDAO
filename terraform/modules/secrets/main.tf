##############################################################################
# Module: secrets
#
# Manages application-level secrets in AWS Secrets Manager and the IAM
# policy that allows ECS tasks to read them (least-privilege).
#
# Secrets owned here:
#   - Application config (Stellar contract ID, JWT secret, etc.)
#
# Secrets owned by other modules but referenced here for the IAM policy:
#   - Postgres credentials  (postgres module)
#   - Redis AUTH token      (redis module)
#
# The ECS task execution role and task role are created in the
# container_service module; this module outputs the policy ARN to attach.
##############################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

# ---------------------------------------------------------------------------
# JWT signing secret
# ---------------------------------------------------------------------------

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "vaultdao/${var.environment}/app/jwt-secret"
  description             = "VaultDAO ${var.environment} JWT signing secret"
  recovery_window_in_days = var.environment == "production" ? 30 : 7

  tags = {
    Name        = "vaultdao-jwt-secret-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt_secret.result

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# App config secret (Stellar contract ID, RPC URL, etc.)
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "app_config" {
  name                    = "vaultdao/${var.environment}/app/config"
  description             = "VaultDAO ${var.environment} application configuration"
  recovery_window_in_days = var.environment == "production" ? 30 : 7

  tags = {
    Name        = "vaultdao-app-config-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "app_config" {
  secret_id = aws_secretsmanager_secret.app_config.id
  secret_string = jsonencode({
    CONTRACT_ID             = var.stellar_contract_id
    STELLAR_NETWORK         = var.stellar_network
    STELLAR_RPC_URL         = var.stellar_rpc_url
    CORS_ORIGIN             = var.cors_origin
    EVENT_POLLING_ENABLED   = tostring(var.event_polling_enabled)
    EVENT_POLLING_INTERVAL_MS = tostring(var.event_polling_interval_ms)
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# IAM policy granting ECS tasks read access to all VaultDAO secrets
#
# Principle: grant GetSecretValue only on the specific secret ARNs for
# this environment. No wildcard on secret names.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "read_secrets" {
  statement {
    sid    = "ReadVaultDAOSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = concat(
      [
        aws_secretsmanager_secret.jwt.arn,
        aws_secretsmanager_secret.app_config.arn,
      ],
      var.extra_secret_arns,
    )
  }

  # Allow ECS to fetch the KMS key used to encrypt secrets (if CMK)
  dynamic "statement" {
    for_each = var.kms_key_arn != null ? [1] : []
    content {
      sid    = "DecryptSecrets"
      effect = "Allow"
      actions = [
        "kms:Decrypt",
        "kms:GenerateDataKey",
      ]
      resources = [var.kms_key_arn]
    }
  }
}

resource "aws_iam_policy" "read_secrets" {
  name        = "vaultdao-read-secrets-${var.environment}"
  description = "Allows VaultDAO ECS tasks to read Secrets Manager secrets for ${var.environment}"
  policy      = data.aws_iam_policy_document.read_secrets.json

  tags = {
    Name        = "vaultdao-read-secrets-policy-${var.environment}"
    Environment = var.environment
  }
}
