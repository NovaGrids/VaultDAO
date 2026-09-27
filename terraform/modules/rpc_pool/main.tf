locals {
  primary_provider   = var.rpc_providers[var.primary_provider_idx]
  backup_providers   = [for i, p in var.rpc_providers : p if i != var.primary_provider_idx]
}

resource "aws_route53_zone" "rpc_pool_zone" {
  name = "rpc-pool.vaultdao.internal"

  vpc {
    vpc_id = var.vpc_id
  }

  tags = {
    Name = "vaultdao-rpc-pool-zone-${var.environment}"
  }
}

resource "aws_route53_record" "primary_rpc" {
  zone_id = aws_route53_zone.rpc_pool_zone.zone_id
  name    = "primary.rpc-pool.vaultdao.internal"
  type    = "CNAME"
  ttl     = 60
  records = [local.primary_provider.endpoint]
}

resource "aws_route53_record" "backup_rpc" {
  count   = length(local.backup_providers)
  zone_id = aws_route53_zone.rpc_pool_zone.zone_id
  name    = "backup-${count.index + 1}.rpc-pool.vaultdao.internal"
  type    = "CNAME"
  ttl     = 60
  records = [local.backup_providers[count.index].endpoint]
}

resource "aws_cloudwatch_metric_alarm" "rpc_health_check" {
  count            = length(var.rpc_providers)
  alarm_name       = "vaultdao-rpc-${var.rpc_providers[count.index].name}-health-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "RpcProviderHealth"
  namespace           = "VaultDAO/RPC"
  period              = "60"
  statistic           = "Average"
  threshold           = "1"
  alarm_description   = "Alert when RPC provider ${var.rpc_providers[count.index].name} is unhealthy"
  treat_missing_data  = "breaching"

  dimensions = {
    Provider = var.rpc_providers[count.index].name
  }
}

resource "kubernetes_config_map" "rpc_config" {
  metadata {
    name      = "rpc-pool-config"
    namespace = "vaultdao"
  }

  data = {
    rpc_endpoints = jsonencode({
      primary = local.primary_provider.endpoint
      backup  = [for p in local.backup_providers : p.endpoint]
      timeout = 30
      retries = 3
    })
  }
}
