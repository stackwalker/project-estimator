#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-project-estimator}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-2}}"
BOOTSTRAP_STACK="${BOOTSTRAP_STACK:-$APP_NAME-ecs-express-bootstrap}"
SERVICE_STACK="${SERVICE_STACK:-$APP_NAME-ecs-express-service}"

echo "Deleting service stack: $SERVICE_STACK"
aws cloudformation delete-stack --region "$AWS_REGION" --stack-name "$SERVICE_STACK"
aws cloudformation wait stack-delete-complete --region "$AWS_REGION" --stack-name "$SERVICE_STACK"

echo "Deleting bootstrap stack: $BOOTSTRAP_STACK"
aws cloudformation delete-stack --region "$AWS_REGION" --stack-name "$BOOTSTRAP_STACK"
aws cloudformation wait stack-delete-complete --region "$AWS_REGION" --stack-name "$BOOTSTRAP_STACK"

echo "Deleted ECS Express infrastructure."
