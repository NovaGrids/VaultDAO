resource "kubernetes_namespace" "vaultdao" {
  metadata {
    name = "vaultdao"
  }
}

resource "kubernetes_secret" "backend_env" {
  metadata {
    name      = "backend-env"
    namespace = kubernetes_namespace.vaultdao.metadata[0].name
  }

  data = {
    DATABASE_URL          = var.database_url
    REDIS_URL             = var.redis_url
    RPC_ENDPOINT          = var.rpc_endpoint
    RPC_BACKUP_ENDPOINTS  = join(",", var.rpc_backup_endpoints)
    LOG_LEVEL             = var.log_level
    NODE_ENV              = var.environment
  }

  type = "Opaque"
}

resource "kubernetes_deployment" "backend" {
  metadata {
    name      = "backend"
    namespace = kubernetes_namespace.vaultdao.metadata[0].name
    labels = {
      app       = "backend"
      version   = "1.0"
      component = "api"
    }
  }

  spec {
    replicas = var.replica_count

    selector {
      match_labels = {
        app = "backend"
      }
    }

    template {
      metadata {
        labels = {
          app = "backend"
        }
      }

      spec {
        container {
          image = var.container_image
          name  = "backend"

          port {
            container_port = var.container_port
            name           = "http"
          }

          env_from {
            secret_ref {
              name = kubernetes_secret.backend_env.metadata[0].name
            }
          }

          resources {
            requests = {
              cpu    = var.cpu_requests
              memory = var.memory_requests
            }
            limits = {
              cpu    = var.cpu_limits
              memory = var.memory_limits
            }
          }

          liveness_probe {
            http_get {
              path   = "/health"
              port   = var.container_port
            }
            initial_delay_seconds = 30
            period_seconds        = 10
          }

          readiness_probe {
            http_get {
              path   = "/ready"
              port   = var.container_port
            }
            initial_delay_seconds = 5
            period_seconds        = 5
          }
        }

        restart_policy = "Always"
      }
    }
  }

  depends_on = [kubernetes_secret.backend_env]
}

resource "kubernetes_service" "backend" {
  metadata {
    name      = "backend"
    namespace = kubernetes_namespace.vaultdao.metadata[0].name
  }

  spec {
    selector = {
      app = "backend"
    }

    port {
      port        = 80
      target_port = var.container_port
    }

    type = "LoadBalancer"
  }

  depends_on = [kubernetes_deployment.backend]
}

resource "kubernetes_horizontal_pod_autoscaler" "backend" {
  metadata {
    name      = "backend-hpa"
    namespace = kubernetes_namespace.vaultdao.metadata[0].name
  }

  spec {
    scale_target_ref {
      api_version = "apps/v1"
      kind        = "Deployment"
      name        = "backend"
    }

    min_replicas = 2
    max_replicas = 10

    target_cpu_utilization_percentage = 70
  }

  depends_on = [kubernetes_deployment.backend]
}
