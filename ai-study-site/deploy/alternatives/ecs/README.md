# ECS alternative — not the active deployment

The initial container deployment draft used ECS Fargate + ALB + a separate GPU service. After the user requested low cost and GPU only during experiments, the active plan changed to a small always-on EC2 + Docker Compose + Caddy and a separately stopped/started GPU EC2.

These files are retained as a future option. No active GitHub workflow executes them and no ECS/ALB resources have been created.
