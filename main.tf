terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" {
  description = "Google Cloud Project ID hosting the GWS JIT Access Portal"
  type        = string
}

variable "region" {
  description = "Primary Google Cloud region for Cloud Run and Firestore"
  type        = string
  default     = "us-central1"
}

variable "container_image" {
  description = "Container image digest or tag in Artifact Registry"
  type        = string
}

variable "domain_name" {
  description = "Custom domain name for the HTTPS Load Balancer (e.g. jit.company.com)"
  type        = string
}

variable "iap_audience" {
  description = "Expected IAP JWT Audience string (/projects/PROJECT_NUMBER/global/backendServices/BACKEND_SERVICE_ID)"
  type        = string
  default     = ""
}

variable "iap_oauth2_client_id" {
  description = "OAuth2 Client ID for Identity-Aware Proxy on the Backend Service"
  type        = string
  default     = ""
}

variable "iap_oauth2_client_secret" {
  description = "OAuth2 Client Secret for Identity-Aware Proxy on the Backend Service"
  type        = string
  sensitive   = true
  default     = ""
}

variable "cron_secret_value" {
  description = "Shared high-entropy secret for authenticating Cloud Scheduler expiration triggers"
  type        = string
  sensitive   = true
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# 1. Least-Privilege Dedicated Service Account for Cloud Run Runtime
resource "google_service_account" "jit_portal_sa" {
  account_id   = "gws-jit-portal-sa"
  display_name = "GWS JIT Access Portal Runtime Service Account"
  description  = "Least-privilege runtime identity for Cloud Run with Firestore and keyless WIF signing access"
}

resource "google_project_iam_member" "firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.jit_portal_sa.email}"
}

resource "google_service_account_iam_member" "wif_token_creator" {
  service_account_id = google_service_account.jit_portal_sa.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.jit_portal_sa.email}"
}

# 2. Secret Manager for Internal Cron Authentication
resource "google_secret_manager_secret" "cron_secret" {
  secret_id = "gws-jit-cron-secret"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "cron_secret_v1" {
  secret      = google_secret_manager_secret.cron_secret.id
  secret_data = var.cron_secret_value
}

resource "google_secret_manager_secret_iam_member" "cron_secret_accessor" {
  secret_id = google_secret_manager_secret.cron_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.jit_portal_sa.email}"
}

# 3. Firestore Native Mode Database
resource "google_firestore_database" "jit_db" {
  project                           = var.project_id
  name                              = "(default)"
  location_id                       = var.region
  type                              = "FIRESTORE_NATIVE"
  deletion_policy                   = "DELETE_PROTECTION_ENABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
}

# 4. Cloud Run v2 Service (Locked to Internal + Cloud Load Balancing Ingress)
resource "google_cloud_run_v2_service" "jit_portal" {
  name     = "gws-jit-portal"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.jit_portal_sa.email

    scaling {
      min_instance_count = 1
      max_instance_count = 5
    }

    containers {
      image = var.container_image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = false
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "DATABASE_ENGINE"
        value = "FIRESTORE"
      }

      env {
        name  = "AUTH_MODE"
        value = "IAP"
      }

      env {
        name  = "REQUIRE_KEYLESS_DWD"
        value = "true"
      }

      env {
        name  = "IAP_AUDIENCE"
        value = var.iap_audience
      }

      env {
        name = "CRON_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cron_secret.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 3
        period_seconds        = 10
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/healthz"
        }
        period_seconds = 30
      }
    }
  }

  depends_on = [google_secret_manager_secret_version.cron_secret_v1]
}

resource "google_cloud_run_v2_service_iam_member" "lb_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.jit_portal.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# 5. Serverless NEG, Cloud Armor WAF & Global HTTPS Load Balancer
resource "google_compute_region_network_endpoint_group" "serverless_neg" {
  name                  = "gws-jit-serverless-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = google_cloud_run_v2_service.jit_portal.name
  }
}

resource "google_compute_security_policy" "waf_policy" {
  name        = "gws-jit-armor-policy"
  description = "Cloud Armor OWASP WAF & rate-limiting policy for GWS JIT Portal"

  rule {
    action   = "deny(403)"
    priority = 1000
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable') || evaluatePreconfiguredWaf('sqli-v33-stable')"
      }
    }
    description = "Block OWASP XSS and SQLi payloads at the edge"
  }

  rule {
    action   = "throttle"
    priority = 2000
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 300
        interval_sec = 60
      }
    }
    description = "Per-IP rate limiting (300 req/min)"
  }

  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow rule behind IAP"
  }
}

resource "google_compute_backend_service" "jit_backend" {
  name                  = "gws-jit-backend-service"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = google_compute_security_policy.waf_policy.id

  backend {
    group = google_compute_region_network_endpoint_group.serverless_neg.id
  }

  dynamic "iap" {
    for_each = var.iap_oauth2_client_id != "" ? [1] : []
    content {
      oauth2_client_id     = var.iap_oauth2_client_id
      oauth2_client_secret = var.iap_oauth2_client_secret
    }
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_iap_web_backend_service_iam_member" "scheduler_iap_accessor" {
  count               = var.iap_oauth2_client_id != "" ? 1 : 0
  project             = var.project_id
  web_backend_service = google_compute_backend_service.jit_backend.name
  role                = "roles/iap.httpsResourceAccessor"
  member              = "serviceAccount:${google_service_account.jit_portal_sa.email}"
}

resource "google_compute_url_map" "jit_url_map" {
  name            = "gws-jit-url-map"
  default_service = google_compute_backend_service.jit_backend.id
}

resource "google_compute_managed_ssl_certificate" "jit_ssl_cert" {
  name = "gws-jit-ssl-cert"
  managed {
    domains = [var.domain_name]
  }
}

resource "google_compute_target_https_proxy" "jit_https_proxy" {
  name             = "gws-jit-https-proxy"
  url_map          = google_compute_url_map.jit_url_map.id
  ssl_certificates = [google_compute_managed_ssl_certificate.jit_ssl_cert.id]
}

resource "google_compute_global_address" "jit_ip" {
  name       = "gws-jit-ip"
  ip_version = "IPV4"
}

resource "google_compute_global_forwarding_rule" "jit_forwarding_rule" {
  name                  = "gws-jit-forwarding-rule"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.jit_https_proxy.id
  ip_address            = google_compute_global_address.jit_ip.id
}

# 6. Cloud Scheduler Job for Deterministic Auto-Revocation (Routed via HTTPS LB + IAP OIDC + Cron Secret)
resource "google_cloud_scheduler_job" "jit_expire_cron" {
  name             = "gws-jit-expire-scheduler"
  description      = "Triggers JIT group membership expiration check every minute via HTTPS Load Balancer"
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "30s"

  http_target {
    http_method = "POST"
    uri         = "https://${var.domain_name}/api/internal/cron/expire"

    headers = {
      "X-Cron-Secret" = var.cron_secret_value
    }

    oidc_token {
      service_account_email = google_service_account.jit_portal_sa.email
      audience              = var.iap_oauth2_client_id != "" ? var.iap_oauth2_client_id : "https://${var.domain_name}"
    }
  }
}
