output "primary_endpoint" {
  value = local.primary_provider.endpoint
}

output "backup_endpoints" {
  value = [for p in local.backup_providers : p.endpoint]
}

output "rpc_pool_zone_id" {
  value = aws_route53_zone.rpc_pool_zone.zone_id
}

output "all_endpoints" {
  value = {
    primary = local.primary_provider.endpoint
    backup  = [for p in local.backup_providers : p.endpoint]
  }
}
