# AWS ECS Express Deployment

This folder contains CloudFormation templates for deploying the estimator app to Amazon ECS Express Mode.

## What Gets Created

- ECR repository for the app image
- ECS cluster
- ECS task execution role
- ECS task role
- ECS Express infrastructure role
- Secrets Manager secret for `MONGODB_URI`
- CloudWatch log group
- ECS Express Gateway Service

ECS Express creates and manages the load balancer, target groups, security groups, autoscaling, networking, and HTTPS endpoint.

## Prerequisites

- AWS CLI configured with credentials
- Docker running locally
- MongoDB Atlas connection string in `.env`

Example `.env`:

```sh
ESTIMATE_STORE=mongodb
MONGODB_URI=mongodb+srv://...
MONGODB_DB=estimator
MONGODB_COLLECTION=estimates
```

## Deploy

```sh
AWS_REGION=us-west-2 ./scripts/aws-ecs-express-deploy.sh
```

Optional overrides:

```sh
APP_NAME=project-estimator \
SERVICE_NAME=project-estimator \
IMAGE_TAG=main \
AWS_REGION=us-west-2 \
./scripts/aws-ecs-express-deploy.sh
```

The script deploys the bootstrap stack, builds and pushes the Docker image to ECR, then deploys the ECS Express service stack.

## GitHub Actions

The workflow at `.github/workflows/deploy-ecs-express.yml` deploys every push to `main`.

Create the GitHub Actions deploy role:

```sh
aws cloudformation deploy \
  --region us-west-2 \
  --stack-name project-estimator-github-actions-oidc \
  --template-file infra/aws/github-actions-oidc-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM
```

If your AWS account already has a GitHub OIDC provider, add:

```sh
--parameter-overrides CreateOidcProvider=false
```

Add these GitHub repository settings:

- Secret `AWS_ROLE_ARN`: the `RoleArn` output from the OIDC stack
- Secret `MONGODB_URI`: your MongoDB Atlas URI
- Variable `AWS_REGION`: `us-west-2`
- Variable `APP_NAME`: `project-estimator`
- Variable `MONGODB_DB`: `estimator`
- Variable `MONGODB_COLLECTION`: `estimates`

## Delete

```sh
AWS_REGION=us-west-2 ./scripts/aws-ecs-express-delete.sh
```
