#!/bin/bash
# Deploy @tideorg/mcp to Azure Container Apps
# Prerequisites: az cli logged in, docker running

set -e

# Configuration
RESOURCE_GROUP="tide-mcp-rg"
LOCATION="australiaeast"
ENVIRONMENT="tide-mcp-env"
APP_NAME="tide-mcp"
IMAGE="tideorg/mcp:latest"

echo "=== Building and pushing Docker image ==="
docker build -t tideorg/mcp:latest -t tideorg/mcp:$(node -p "require('./package.json').version") .
docker push tideorg/mcp:latest
docker push tideorg/mcp:$(node -p "require('./package.json').version")

echo "=== Deploying to Azure Container Apps (${LOCATION}) ==="

# Create resource group (idempotent)
az group create --name $RESOURCE_GROUP --location $LOCATION --output none

# Create environment (idempotent)
az containerapp env create \
  --name $ENVIRONMENT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --output none 2>/dev/null || true

# Create or update container app.
# --min-replicas 1 keeps one instance warm. With min 0 the app scales to zero
# when idle; the next request cold-starts and the TLS handshake resets before a
# replica is ready — which is exactly what `npm run test:remote` was hitting.
# Keep >=1 for a reliable always-on public endpoint. The update branch must set
# it too, or re-running this on an app first created with min 0 leaves it at 0.
az containerapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --environment $ENVIRONMENT \
  --image $IMAGE \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 0.25 --memory 0.5Gi \
  --output none 2>/dev/null || \
az containerapp update \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --image $IMAGE \
  --min-replicas 1 \
  --max-replicas 3 \
  --output none

# Get the URL
FQDN=$(az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "=== Deployed ==="
echo "MCP endpoint: https://${FQDN}/mcp"
echo "Health check: https://${FQDN}/health"
echo ""
echo "Developers connect with:"
echo '  { "mcpServers": { "tide": { "url": "https://'${FQDN}'/mcp" } } }'
