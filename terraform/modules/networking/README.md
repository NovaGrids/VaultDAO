# Module: networking

Creates a hardened, multi-AZ VPC for VaultDAO with strict tier separation.

## Architecture

```
Internet
   │
   ▼
Public subnets  ──► ALB (HTTPS/HTTP)
   │                 │
   │                 │ port <app_port> only
   ▼                 ▼
NAT Gateways    Private subnets  ──► ECS Fargate tasks
   │                                      │
   │                               5432 / 6379
   │                                      │
   └──────────────────────────────────────┘
                                          ▼
                                 Data subnets  ──► RDS Postgres
                                               ──► ElastiCache Redis
```

## Security model

| Tier | Subnets | Inbound | Outbound |
|------|---------|---------|----------|
| ALB | Public | 443/80 from 0.0.0.0/0 | port `app_port` to app-sg |
| App (ECS) | Private | port `app_port` from alb-sg | 5432 → postgres-sg; 6379 → redis-sg; 443 → internet (NAT) |
| Redis | Data | **6379 from app-sg only** | none |
| Postgres | Data | **5432 from app-sg only** | none |

Redis and Postgres are **never reachable from public subnets or the internet**. The security groups use `source_security_group_id` references, not CIDR blocks, so there is no path from outside the VPC even if the VPC CIDR changes.

## Threat notes

- **Port 6379 (Redis)**: Restricted to `app_sg_id` via security group rule. No public access. If Redis were accidentally placed in a public subnet it would still be blocked at the SG layer.
- **Port 5432 (Postgres)**: Same pattern — `postgres_sg_id` accepts only from `app_sg_id`. `publicly_accessible = false` on the RDS instance is a second layer of defence.
- **NAT Gateways**: One per AZ prevents a single-point-of-failure on egress.
- **VPC Flow Logs**: All traffic (ACCEPT + REJECT) is logged to CloudWatch for forensic analysis.
- **No overly broad egress**: The app security group restricts egress to known ports (5432, 6379, 443). It does not use `0.0.0.0/0 -1` egress.

## Usage

```hcl
module "networking" {
  source = "../../modules/networking"

  environment  = "production"
  vpc_cidr     = "10.0.0.0/16"
  az_count     = 3
  app_port     = 8787
}
```

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `environment` | string | — | `staging` or `production` |
| `vpc_cidr` | string | `10.0.0.0/16` | VPC CIDR (must be /16) |
| `az_count` | number | `2` | Number of AZs (2–4) |
| `app_port` | number | `8787` | Backend application port |
| `flow_log_retention_days` | number | `30` | CloudWatch retention for flow logs |

## Outputs

| Name | Description |
|------|-------------|
| `vpc_id` | VPC ID |
| `public_subnet_ids` | Public subnet IDs (ALB) |
| `private_subnet_ids` | Private subnet IDs (ECS) |
| `data_subnet_ids` | Data-tier subnet IDs (RDS, Redis) |
| `alb_sg_id` | ALB security group |
| `app_sg_id` | App (ECS) security group |
| `redis_sg_id` | Redis security group |
| `postgres_sg_id` | Postgres security group |
| `nat_gateway_ids` | NAT Gateway IDs |
| `nat_public_ips` | NAT EIPs (for external allowlisting) |
