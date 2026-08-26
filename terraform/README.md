# VaultDAO Infrastructure as Code (Terraform)

This directory contains Terraform configuration for provisioning and managing VaultDAO's production infrastructure on AWS.

## Overview

The infrastructure includes:
- **Networking (VPC):** Multi-AZ VPC with public, private, and database subnets
- **EKS Cluster:** Kubernetes cluster for running containerized workloads
- **Backend Service:** Node.js backend application deployed on Kubernetes
- **PostgreSQL Database:** RDS instance with Multi-AZ support and automated backups
- **Redis Cache:** ElastiCache cluster for session and data caching
- **RPC Pool:** Multi-provider Ethereum RPC endpoints with failover
- **Monitoring:** Prometheus and Grafana for metrics collection and visualization

## Directory Structure

```
terraform/
├── main.tf                      # Main Terraform configuration
├── backend.tf                   # Remote backend configuration (S3 + DynamoDB)
├── variables.tf                 # Variable definitions
├── terraform.tfvars.example     # Example variable values
├── README.md                    # This file
├── modules/
│   ├── vpc/                     # VPC and networking
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── backend/                 # Backend state bootstrap module
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── database/                # PostgreSQL RDS
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── redis/                   # ElastiCache Redis
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── rpc_pool/                # RPC provider management
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── monitoring/              # Prometheus and Grafana
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
└── backend-bootstrap/           # One-time backend bootstrap config
    ├── main.tf
    ├── variables.tf
    └── terraform.tfvars.example
```

## Prerequisites

1. **AWS Account:** You need an AWS account with appropriate permissions
2. **Terraform:** Install Terraform >= 1.0
3. **AWS CLI:** Configure AWS credentials
4. **kubectl:** Install kubectl for Kubernetes operations
5. **Helm:** Install Helm for Kubernetes package management

```bash
# Install Terraform
brew install terraform  # macOS
# or download from https://www.terraform.io/downloads

# Configure AWS credentials
aws configure

# Install kubectl
brew install kubectl  # macOS

# Install Helm
brew install helm  # macOS
```

## Initial Setup

### 1. Bootstrap Terraform Remote State Backend

The remote backend requires an S3 bucket and DynamoDB table for state locking. Use the `backend-bootstrap/` config to create these resources once.

```bash
cd terraform/backend-bootstrap

# Copy example variables
cp terraform.tfvars.example terraform.tfvars

# Edit with your values
nano terraform.tfvars

# Initialize Terraform
terraform init

# Apply to create backend resources
terraform apply
```

This creates:
- **S3 bucket** (`terraform_state_bucket`) with versioning and encryption enabled
- **DynamoDB table** (`terraform_lock_table`) for state locking

### 2. Configure Remote Backend

```bash
cd terraform

# Initialize with remote backend
terraform init \
  -backend-config="bucket=vaultdao-terraform-state" \
  -backend-config="key=production/terraform.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="encrypt=true" \
  -backend-config="dynamodb_table=terraform-lock"
```

### 3. Prepare Variables

```bash
# Copy example variables
cp terraform.tfvars.example terraform.tfvars

# Edit with your values
nano terraform.tfvars
```

### 3. Initialize Terraform

```bash
terraform init
```

## Usage

### Plan Infrastructure

Review changes before applying:

```bash
terraform plan -out=tfplan
```

### Apply Infrastructure

Deploy the infrastructure:

```bash
terraform apply tfplan
```

This will create:
- VPC with public, private, and database subnets
- EKS cluster with worker nodes
- PostgreSQL RDS instance
- Redis cluster
- Backend service deployment
- Monitoring stack (Prometheus + Grafana)

### Verify Deployment

```bash
# Get EKS cluster credentials
aws eks update-kubeconfig --name vaultdao-production --region us-east-1

# Verify backend pods are running
kubectl get pods -n vaultdao

# Verify monitoring is running
kubectl get pods -n monitoring

# Get Grafana URL
terraform output monitoring_grafana_url

# Get load balancer endpoint
terraform output load_balancer_dns
```

### Destroy Infrastructure

⚠️ **WARNING:** This will delete all resources including the database.

```bash
terraform destroy
```

## Module Documentation

### VPC Module

Creates networking infrastructure with:
- VPC with configurable CIDR
- Public subnets with Internet Gateway
- Private subnets with NAT Gateways
- Database subnets for RDS

**Key Outputs:**
- `vpc_id`: VPC ID
- `public_subnet_ids`: Public subnet IDs
- `private_subnet_ids`: Private subnet IDs
- `database_subnet_ids`: Database subnet IDs

### Backend Module

Deploys backend service to Kubernetes:
- Creates namespace
- Deploys application with configurable replicas
- Sets up horizontal pod autoscaler
- Exposes service via load balancer

**Key Outputs:**
- `backend_service_endpoint`: Service endpoint

### Database Module

Provisions RDS PostgreSQL instance:
- Multi-AZ deployment
- Automated backups
- Encrypted storage
- CloudWatch logs integration

**Key Outputs:**
- `endpoint`: Database endpoint
- `connection_string`: PostgreSQL connection string (sensitive)

### Redis Module

Creates ElastiCache Redis cluster:
- Multi-node with automatic failover
- Encryption at rest and in transit
- CloudWatch logs for slow queries

**Key Outputs:**
- `endpoint`: Redis endpoint
- `connection_string`: Redis connection URL

### RPC Pool Module

Manages Ethereum RPC endpoints:
- Configures primary and backup RPC providers
- Health checks via CloudWatch alarms
- Kubernetes config map for endpoint configuration

**Key Outputs:**
- `primary_endpoint`: Primary RPC endpoint
- `backup_endpoints`: List of backup endpoints

### Monitoring Module

Deploys Prometheus and Grafana:
- Prometheus for metrics collection
- Grafana for visualization
- AlertManager for alerting
- Pre-configured dashboards and alerts

**Key Outputs:**
- `grafana_url`: Grafana dashboard URL
- `prometheus_url`: Prometheus query URL

## Common Operations

### Scale Backend

Update the desired replica count:

```bash
terraform apply -var="backend_replica_count=5"
```

### Update Database

Modify database configuration:

```bash
terraform apply -var="db_instance_class=db.t3.large"
```

### Add New RPC Provider

Update the RPC providers list:

```bash
terraform apply -var='rpc_providers=[
  {name="infura", endpoint="https://...", priority=1},
  {name="alchemy", endpoint="https://...", priority=2},
  {name="quicknode", endpoint="https://...", priority=3}
]'
```

### Upgrade Kubernetes Version

```bash
terraform apply -var="kubernetes_version=1.29"
```

## Terraform State Management

State is stored remotely in S3 with DynamoDB locking to prevent concurrent modifications.

### Backend Configuration

The backend is configured in `backend.tf` with values supplied during `terraform init`:

```hcl
terraform {
  backend "s3" {}
}
```

Initialize with backend config:

```bash
terraform init \
  -backend-config="bucket=vaultdao-terraform-state" \
  -backend-config="key=production/terraform.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="encrypt=true" \
  -backend-config="dynamodb_table=terraform-lock"
```

### State Operations

```bash
# View current state
terraform show

# List state resources
terraform state list

# View specific resource
terraform state show module.database.aws_db_instance.main

# Remove resource from state (use with caution)
terraform state rm module.backend.kubernetes_deployment.backend
```

### Handling Lock Timeouts

If Terraform is stuck waiting for a lock:

```bash
# List locks
aws dynamodb scan --table-name terraform-lock

# Remove stale lock (use with caution)
aws dynamodb delete-item \
  --table-name terraform-lock \
  --key '{"LockID": {"S": "vaultdao-terraform-state/production/terraform.tfstate"}}'
```

### Migrating Local State to Remote

If you have existing local state:

```bash
# First, bootstrap the backend (see Initial Setup)
# Then migrate:
terraform init -migrate-state
```

## Monitoring & Alerts

Access Grafana dashboards:

```bash
# Get Grafana URL
terraform output monitoring_grafana_url

# Default credentials: admin / <your_grafana_admin_password>
```

Alerts are configured for:
- High error rates (>5%)
- RPC provider unavailability
- Event processing lag
- Storage capacity warnings

## Troubleshooting

### EKS Cluster Access Denied

```bash
# Update kubeconfig
aws eks update-kubeconfig \
  --name vaultdao-production \
  --region us-east-1
```

### Database Connection Failed

```bash
# Verify security group
aws ec2 describe-security-groups \
  --group-ids sg-xxx \
  --region us-east-1

# Test connection from backend pod
kubectl exec -it <pod-name> -n vaultdao -- \
  psql -h <db-endpoint> -U postgres
```

### Terraform Lock Timeout

If Terraform is stuck waiting for a lock:

```bash
# List locks
aws dynamodb scan --table-name terraform-lock

# Remove stale lock (use with caution)
aws dynamodb delete-item \
  --table-name terraform-lock \
  --key '{"LockID": {"S": "vaultdao-terraform-state/production/terraform.tfstate"}}'
```

## Cost Optimization

To reduce costs in non-production environments:

```bash
# Use smaller instances
terraform apply -var='db_instance_class=db.t3.micro' \
                -var='redis_node_type=cache.t3.micro' \
                -var='node_instance_types=["t3.small"]'

# Disable Multi-AZ
terraform apply -var='db_multi_az=false' \
                -var='redis_automatic_failover=false'

# Reduce replica count
terraform apply -var='backend_replica_count=1'
```

## Maintenance

### Regular Backups

Automated daily backups are configured for RDS (30-day retention).

### Update Dependencies

Check for provider updates:

```bash
terraform init -upgrade
```

### Review Terraform Drift

```bash
terraform plan
```

If changes appear but you didn't make them, investigate and document why.

## Support

For issues or questions:
1. Check the Terraform logs: `TF_LOG=DEBUG terraform plan`
2. Review AWS Console for resource status
3. Check Kubernetes events: `kubectl describe nodes`
4. Review CloudWatch logs

## Additional Resources

- [Terraform AWS Provider Documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [AWS EKS Documentation](https://docs.aws.amazon.com/eks/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [VaultDAO Backend Documentation](../backend/README.md)
