##############################################################################
# Module: container_service
#
# Runs the VaultDAO backend as an ECS Fargate service with:
#   - Application Load Balancer (HTTPS termination via ACM)
#   - ECS Cluster + Fargate service with configurable desired count
#   - Task execution role (pull ECR, read Secrets Manager)
#   - Task role (least-privilege, secrets read policy attached)
#   - Container-level secrets injection from Secrets Manager (no plaintext env vars)
#   - Auto Scaling on CPU and memory
#   - CloudWatch Log Group for container logs
##############################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# CloudWatch Log Group
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/vaultdao-backend-${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Name        = "vaultdao-backend-logs-${var.environment}"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# ECR Repository
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "backend" {
  name                 = "vaultdao/backend"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name        = "vaultdao-backend-ecr"
    Environment = var.environment
  }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 10 release images"
        selection = {
          tagStatus      = "tagged"
          tagPrefixList  = ["release-"]
          countType      = "imageCountMoreThan"
          countNumber    = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# IAM — Task Execution Role (ECS agent: pull ECR, push logs, read secrets)
# ---------------------------------------------------------------------------

resource "aws_iam_role" "task_execution" {
  name = "vaultdao-ecs-exec-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Environment = var.environment }
}

resource "aws_iam_role_policy_attachment" "exec_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "exec_secrets" {
  role       = aws_iam_role.task_execution.name
  policy_arn = var.read_secrets_policy_arn
}

# ---------------------------------------------------------------------------
# IAM — Task Role (application code: Secrets Manager, CloudWatch metrics)
# ---------------------------------------------------------------------------

resource "aws_iam_role" "task" {
  name = "vaultdao-ecs-task-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Environment = var.environment }
}

resource "aws_iam_role_policy_attachment" "task_secrets" {
  role       = aws_iam_role.task.name
  policy_arn = var.read_secrets_policy_arn
}

resource "aws_iam_role_policy" "task_cloudwatch" {
  name = "vaultdao-task-cloudwatch-${var.environment}"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "cloudwatch:PutMetricData",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]
      Resource = "*"
    }]
  })
}

# ---------------------------------------------------------------------------
# ECS Cluster
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = "vaultdao-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name        = "vaultdao-cluster-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = var.environment == "production" ? "FARGATE" : "FARGATE_SPOT"
    weight            = 1
    base              = var.environment == "production" ? 1 : 0
  }
}

# ---------------------------------------------------------------------------
# Task Definition
# ---------------------------------------------------------------------------

locals {
  # Build the secrets list for the ECS container definition from the
  # secret ARNs provided by the postgres, redis, and secrets modules.
  # ECS injects these as environment variables at task start — no plaintext.
  secret_injections = [
    for s in var.secret_injections : {
      name      = s.env_var_name
      valueFrom = s.secret_arn
    }
  ]
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "vaultdao-backend-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.container_image != "" ? var.container_image : "${aws_ecr_repository.backend.repository_url}:latest"
      essential = true

      portMappings = [
        {
          containerPort = var.app_port
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "PORT",     value = tostring(var.app_port) },
        { name = "HOST",     value = "0.0.0.0" },
        { name = "NODE_ENV", value = var.environment == "production" ? "production" : "staging" },
      ]

      # Secrets are injected from Secrets Manager — not stored as plaintext.
      secrets = local.secret_injections

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "backend"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:${var.app_port}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      readonlyRootFilesystem = false
      user                   = "node"
    }
  ])

  tags = {
    Name        = "vaultdao-backend-task-${var.environment}"
    Environment = var.environment
  }
}

# ---------------------------------------------------------------------------
# ALB
# ---------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "vaultdao-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_sg_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.environment == "production"

  tags = {
    Name        = "vaultdao-alb-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_lb_target_group" "backend" {
  name        = "vaultdao-backend-${var.environment}"
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  tags = {
    Name        = "vaultdao-backend-tg-${var.environment}"
    Environment = var.environment
  }
}

# HTTP → HTTPS redirect
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}

# ---------------------------------------------------------------------------
# ECS Service
# ---------------------------------------------------------------------------

resource "aws_ecs_service" "backend" {
  name            = "vaultdao-backend-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_count

  launch_type = var.environment == "production" ? "FARGATE" : null

  dynamic "capacity_provider_strategy" {
    for_each = var.environment != "production" ? [1] : []
    content {
      capacity_provider = "FARGATE_SPOT"
      weight            = 1
    }
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.app_sg_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = var.app_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  health_check_grace_period_seconds = 60

  tags = {
    Name        = "vaultdao-backend-service-${var.environment}"
    Environment = var.environment
  }

  depends_on = [
    aws_lb_listener.https,
    aws_iam_role_policy_attachment.exec_managed,
    aws_iam_role_policy_attachment.exec_secrets,
  ]

  lifecycle {
    ignore_changes = [
      # Allow external CI deploys to update the task definition
      task_definition,
      desired_count,
    ]
  }
}

# ---------------------------------------------------------------------------
# Auto Scaling
# ---------------------------------------------------------------------------

resource "aws_appautoscaling_target" "backend" {
  max_capacity       = var.max_count
  min_capacity       = var.min_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "vaultdao-backend-cpu-scaling-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "memory" {
  name               = "vaultdao-backend-memory-scaling-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 75
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
