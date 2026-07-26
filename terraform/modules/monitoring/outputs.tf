output "grafana_url" {
  value = kubernetes_service.grafana.status[0].load_balancer[0].ingress[0].hostname
}

output "prometheus_url" {
  value = "http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090"
}

output "alertmanager_url" {
  value = "http://alertmanager-kube-prometheus-alertmanager.monitoring.svc.cluster.local:9093"
}

output "monitoring_namespace" {
  value = kubernetes_namespace.monitoring.metadata[0].name
}
