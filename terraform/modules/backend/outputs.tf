output "backend_service_endpoint" {
  value = kubernetes_service.backend.status[0].load_balancer[0].ingress[0].hostname
}

output "backend_namespace" {
  value = kubernetes_namespace.vaultdao.metadata[0].name
}
