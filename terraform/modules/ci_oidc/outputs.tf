output "role_arn" {
  description = "IAM role ARN to supply as 'role-to-assume' in the GitHub Actions aws-actions/configure-aws-credentials step."
  value       = aws_iam_role.ci_deploy.arn
}

output "role_name" {
  description = "IAM role name."
  value       = aws_iam_role.ci_deploy.name
}

output "oidc_provider_arn" {
  description = "OIDC Identity Provider ARN (shared across all environments in the same account)."
  value       = aws_iam_openid_connect_provider.github.arn
}
