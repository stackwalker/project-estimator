#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-project-estimator}"
SERVICE_NAME="${SERVICE_NAME:-$APP_NAME}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-2}}"
BOOTSTRAP_STACK="${BOOTSTRAP_STACK:-$APP_NAME-ecs-express-bootstrap}"
SERVICE_STACK="${SERVICE_STACK:-$APP_NAME-ecs-express-service}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
MONGODB_DB="${MONGODB_DB:-}"
MONGODB_COLLECTION="${MONGODB_COLLECTION:-}"

if [[ -f "$ROOT_DIR/.env" ]]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
    value="${value%$'\r'}"
    case "$key" in
      MONGODB_URI) MONGODB_URI="${MONGODB_URI:-$value}" ;;
      MONGODB_DB) MONGODB_DB="${MONGODB_DB:-$value}" ;;
      MONGODB_COLLECTION) MONGODB_COLLECTION="${MONGODB_COLLECTION:-$value}" ;;
    esac
  done < "$ROOT_DIR/.env"
fi

MONGODB_DB="${MONGODB_DB:-estimator}"
MONGODB_COLLECTION="${MONGODB_COLLECTION:-estimates}"

if ! command -v aws >/dev/null; then
  echo "aws CLI is required." >&2
  exit 1
fi

if ! command -v docker >/dev/null; then
  echo "docker is required." >&2
  exit 1
fi

stack_exists() {
  aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$1" >/dev/null 2>&1
}

stack_output() {
  aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" \
    --output text
}

if [[ -z "${MONGODB_URI:-}" ]]; then
  echo "MONGODB_URI is required." >&2
  echo "Set it in .env or export it before running this script." >&2
  exit 1
fi

bootstrap_parameters=(
  "AppName=$APP_NAME"
  "MongoDbUri=$MONGODB_URI"
  "MongoDbName=$MONGODB_DB"
  "MongoDbCollection=$MONGODB_COLLECTION"
)

echo "Deploying bootstrap stack: $BOOTSTRAP_STACK"
aws cloudformation deploy \
  --region "$AWS_REGION" \
  --stack-name "$BOOTSTRAP_STACK" \
  --template-file "$ROOT_DIR/infra/aws/ecs-express-bootstrap.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides "${bootstrap_parameters[@]}"

repository_uri="$(stack_output "$BOOTSTRAP_STACK" RepositoryUri)"
cluster_name="$(stack_output "$BOOTSTRAP_STACK" ClusterName)"
execution_role_arn="$(stack_output "$BOOTSTRAP_STACK" TaskExecutionRoleArn)"
task_role_arn="$(stack_output "$BOOTSTRAP_STACK" TaskRoleArn)"
infrastructure_role_arn="$(stack_output "$BOOTSTRAP_STACK" InfrastructureRoleArn)"
mongodb_secret_arn="$(stack_output "$BOOTSTRAP_STACK" MongoDbUriSecretArn)"
mongodb_db="$(stack_output "$BOOTSTRAP_STACK" MongoDbName)"
mongodb_collection="$(stack_output "$BOOTSTRAP_STACK" MongoDbCollection)"
log_group_name="$(stack_output "$BOOTSTRAP_STACK" LogGroupName)"
image_uri="$repository_uri:$IMAGE_TAG"

echo "Logging in to ECR: $repository_uri"
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "${repository_uri%/*}"

echo "Building image: $image_uri"
docker build --platform linux/amd64 -t "$image_uri" "$ROOT_DIR"

echo "Pushing image: $image_uri"
docker push "$image_uri"

echo "Deploying ECS Express service stack: $SERVICE_STACK"
aws cloudformation deploy \
  --region "$AWS_REGION" \
  --stack-name "$SERVICE_STACK" \
  --template-file "$ROOT_DIR/infra/aws/ecs-express-service.yaml" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "AppName=$APP_NAME" \
    "ServiceName=$SERVICE_NAME" \
    "ClusterName=$cluster_name" \
    "ImageUri=$image_uri" \
    "ExecutionRoleArn=$execution_role_arn" \
    "TaskRoleArn=$task_role_arn" \
    "InfrastructureRoleArn=$infrastructure_role_arn" \
    "MongoDbUriSecretArn=$mongodb_secret_arn" \
    "MongoDbName=$mongodb_db" \
    "MongoDbCollection=$mongodb_collection" \
    "LogGroupName=$log_group_name"

endpoint="$(stack_output "$SERVICE_STACK" Endpoint)"
echo "Deployment complete."
echo "Endpoint: $endpoint"
