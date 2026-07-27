resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = "monitoring"
  }
}

resource "helm_release" "prometheus" {
  name       = "prometheus"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  version    = "51.0.0"

  values = [
    yamlencode({
      prometheus = {
        prometheusSpec = {
          retention       = var.prometheus_retention
          storageSpec = {
            volumeClaimTemplate = {
              spec = {
                accessModes = ["ReadWriteOnce"]
                resources = {
                  requests = {
                    storage = "50Gi"
                  }
                }
              }
            }
          }
          serviceMonitorSelectorNilUsesHelmValues = false
          podMonitorSelectorNilUsesHelmValues     = false
        }
      }
      grafana = {
        adminPassword = var.grafana_admin_password != "" ? var.grafana_admin_password : "admin"
        persistence = {
          enabled = true
          size    = "10Gi"
        }
        datasources = {
          datasources.yaml = {
            apiVersion = 1
            datasources = [
              {
                name      = "Prometheus"
                type      = "prometheus"
                url       = "http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090"
                access    = "proxy"
                isDefault = true
              }
            ]
          }
        }
      }
      alertmanager = {
        enabled = true
        alertmanagerSpec = {
          storage = {
            volumeClaimTemplate = {
              spec = {
                accessModes = ["ReadWriteOnce"]
                resources = {
                  requests = {
                    storage = "10Gi"
                  }
                }
              }
            }
          }
        }
      }
    })
  ]

  depends_on = [kubernetes_namespace.monitoring]
}

resource "kubernetes_config_map" "alertmanager_config" {
  metadata {
    name      = "alertmanager-config"
    namespace = kubernetes_namespace.monitoring.metadata[0].name
  }

  data = {
    alertmanager-config = yamlencode({
      global = {
        resolve_timeout = "5m"
        slack_api_url   = var.slack_webhook_url
      }
      route = {
        receiver = "default"
        routes = [
          {
            match = {
              severity = "critical"
            }
            receiver            = "critical"
            group_wait          = "10s"
            group_interval      = "10s"
            repeat_interval     = "12h"
          }
        ]
      }
      receivers = [
        {
          name = "default"
          slack_configs = [
            {
              api_url = var.slack_webhook_url
              channel = "#alerts"
              title   = "VaultDAO Alert"
            }
          ]
        },
        {
          name = "critical"
          slack_configs = [
            {
              api_url = var.slack_webhook_url
              channel = "#critical-alerts"
              title   = "CRITICAL: VaultDAO Alert"
            }
          ]
          email_configs = [
            {
              to       = var.alert_email
              from     = "alerts@vaultdao.io"
              smarthost = "smtp.gmail.com:587"
              auth_username = "alerts@vaultdao.io"
              headers = {
                Subject = "{{ .GroupLabels.alertname }}"
              }
            }
          ]
        }
      ]
    })
  }

  depends_on = [kubernetes_namespace.monitoring]
}

resource "kubernetes_config_map" "prometheus_rules" {
  metadata {
    name      = "vaultdao-prometheus-rules"
    namespace = kubernetes_namespace.monitoring.metadata[0].name
  }

  data = {
    vaultdao-rules = yamlencode({
      groups = [
        {
          name  = "vaultdao.rules"
          interval = "30s"
          rules = [
            {
              alert = "HighErrorRate"
              expr  = "increase(vaultdao_http_requests_total{status=~'5..'}[5m]) / increase(vaultdao_http_requests_total[5m]) > 0.05"
              for   = "5m"
              labels = {
                severity = "critical"
              }
              annotations = {
                summary     = "High error rate detected"
                description = "Error rate is {{ $value | humanizePercentage }}"
              }
            },
            {
              alert = "RPCProviderDown"
              expr  = "vaultdao_rpc_provider_health == 0"
              for   = "1m"
              labels = {
                severity = "critical"
              }
              annotations = {
                summary     = "RPC provider {{ $labels.provider }} is down"
                description = "RPC provider {{ $labels.provider }} has been unreachable for 1 minute"
              }
            },
            {
              alert = "EventProcessingLagHigh"
              expr  = "vaultdao_event_processing_lag_seconds > 300"
              for   = "10m"
              labels = {
                severity = "high"
              }
              annotations = {
                summary     = "Event processing lag is high"
                description = "Event processing lag is {{ $value | humanizeDuration }}"
              }
            },
            {
              alert = "StorageCritical"
              expr  = "node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.1"
              for   = "5m"
              labels = {
                severity = "critical"
              }
              annotations = {
                summary     = "Storage is running out"
                description = "Less than 10% storage remaining on {{ $labels.device }}"
              }
            }
          ]
        }
      ]
    })
  }

  depends_on = [kubernetes_namespace.monitoring]
}

resource "kubernetes_service" "grafana" {
  metadata {
    name      = "grafana-external"
    namespace = kubernetes_namespace.monitoring.metadata[0].name
  }

  spec {
    selector = {
      "app.kubernetes.io/name" = "grafana"
    }

    port {
      port        = 80
      target_port = 3000
    }

    type = "LoadBalancer"
  }

  depends_on = [helm_release.prometheus]
}
