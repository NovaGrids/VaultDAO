##############################################################################
# Module: ci_oidc
#
# Creates the AWS IAM resources for keyless GitHub Actions deployments via
# OpenID Connect (OIDC). No long-lived AWS credentials are stored in GitHub
# Secrets — the CI workflow exchanges a short-lived GitHub token for
# temporary AWS credentials scoped to this environment.
#
# Resources created:
#   - OIDC Identity Provider (GitHub Actions)
#   - IAM role that GitHub Actions can assume
#   - Least-privilege policy: push to ECR + update ECS service
#
# The trust policy restricts assumption to:
#   - A specific GitHub org/repo
#   - Optionally a specific branch or environment (recommended for prod)
##############################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# OIDC Provider (one per AWS account; use data source if already exists)
# ---------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub's OIDC thumbprint (stable; listed in AWS docs)
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]

  tags = {
    Name        = "github-actions-oidc"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# Trust Policy — restricts to specific repo (and optionally branch/env)
# ---------------------------------------------------------------------------

locals {
  # Subject pattern. For branch-scoped deployments use:
  #   "repo:<org>/<repo>:ref:refs/heads/<branch>"
  # For environment-scoped (GitHub Environments):
  #   "repo:<org>/<repo>:environment:<environment>"
  subject_claims = var.allowed_branches != null ? [
    for branch in var.allowed_branches :
    "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${branch}"
    ] : [
    "repo:${var.github_org}/${var.github_repo}:environment:${var.environment}"
  ]
}

data "aws_iam_policy_document" "trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.subject_claims
    }
  }
}

# ---------------------------------------------------------------------------
# IAM Role
# ---------------------------------------------------------------------------

resource "aws_iam_role" "ci_deploy" {
  name               = "vaultdao-ci-deploy-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600 # 1 hour

  tags = {
    Name        = "vaultdao-ci-deploy-role-${var.environment}"
    Environment = var.environment
    Purpose     = "GitHub Actions OIDC deploy role"
  }
}

# ---------------------------------------------------------------------------
# Deploy Policy — ECR push + ECS service update + read task definition
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "deploy" {
  # ECR authentication
  statement {
    sid    = "ECRAuth"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }

  # ECR image push to the backend repository only
  statement {
    sid    = "ECRPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:DescribeImages",
    ]
    resources = var.ecr_repository_arns
  }

  # ECS deploy: register new task definition + update service
  statement {
    sid    = "ECSRegisterTask"
    effect = "Allow"
    actions = [
      "ecs:RegisterTaskDefinition",
      "ecs:DescribeTaskDefinition",
      "ecs:DeregisterTaskDefinition",
    ]
    resources = ["*"] # task definition ARNs are not known until registration
  }

  statement {
    sid    = "ECSUpdateService"
    effect = "Allow"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:DescribeClusters",
      "ecs:ListTasks",
      "ecs:DescribeTasks",
    ]
    resources = var.ecs_service_arns
  }

  # Allow ECS to pass the task execution and task roles when registering
  statement {
    sid    = "PassRoleToECS"
    effect = "Allow"
    actions = ["iam:PassRole"]
    resources = var.ecs_task_role_arns
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # Read Secrets Manager (to validate config exists, not to read values)
  statement {
    sid    = "ListSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:ListSecrets",
      "secretsmanager:DescribeSecret",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "deploy" {
  name        = "vaultdao-ci-deploy-policy-${var.environment}"
  description = "GitHub Actions OIDC deploy policy for VaultDAO ${var.environment}"
  policy      = data.aws_iam_policy_document.deploy.json

  tags = {
    Name        = "vaultdao-ci-deploy-policy-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "deploy" {
  role       = aws_iam_role.ci_deploy.name
  policy_arn = aws_iam_policy.deploy.arn
}
