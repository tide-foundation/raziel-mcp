#!/bin/bash
# Deploy @tideorg/mcp to Azure Container Apps
# Prerequisites: az cli logged in, docker running

set -e

# Configuration
RESOURCE_GROUP="tide-mcp-rg"
LOCATION="australiaeast"
ENVIRONMENT="tide-mcp-env"
APP_NAME="tide-mcp"
VERSION=$(node -p "require('./package.json').version")
IMAGE="tideorg/mcp:$VERSION"   # deploy the VERSIONED tag: Azure Container Apps won't re-pull an unchanged :latest, so deploying :latest silently no-ops

echo "=== Building and pushing Docker image ($VERSION) ==="
docker build -t tideorg/mcp:latest -t "$IMAGE" .
docker push tideorg/mcp:latest
docker push "$IMAGE"

echo "=== Deploying to Azure Container Apps (${LOCATION}) ==="

# Create resource group (idempotent)
az group create --name $RESOURCE_GROUP --location $LOCATION --output none

# Create environment (idempotent)
az containerapp env create \
  --name $ENVIRONMENT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --output none 2>/dev/null || true

# Create the app on first deploy, or UPDATE an existing one — never a fresh
# `create` on an existing app. `create` rebuilds the whole template and DROPS
# env vars + secrets not passed on the command line (that is how the App Insights
# connection string kept getting wiped on redeploy, silently killing telemetry).
# `update` only changes what's named, preserving env vars, secrets, and the
# custom-domain binding. --min-replicas 1 keeps one instance warm (min 0 scales
# to zero and the cold-start resets the TLS handshake before a replica is ready).
if az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --output none 2>/dev/null; then
  echo "=== Updating existing app (preserves env vars + secrets) ==="
  az containerapp update \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --image $IMAGE \
    --min-replicas 1 \
    --max-replicas 3 \
    --output none
else
  echo "=== Creating app (first deploy) ==="
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
    --output none
fi

# Re-bind the custom domain (idempotent). The mcp.tide.org binding has been
# observed to drop on some deploy operations; re-applying it here keeps the
# hosted endpoint self-healing. Requires the DNS CNAME + asuid TXT already set.
CUSTOM_DOMAIN="mcp.tide.org"
if ! az containerapp hostname list --name $APP_NAME --resource-group $RESOURCE_GROUP \
     --query "[].name" -o tsv 2>/dev/null | grep -qx "$CUSTOM_DOMAIN"; then
  echo "=== Re-binding custom domain ${CUSTOM_DOMAIN} ==="
  az containerapp hostname bind \
    --hostname $CUSTOM_DOMAIN \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --environment $ENVIRONMENT \
    --validation-method CNAME \
    --output none 2>/dev/null \
    || echo "  (bind skipped — check DNS CNAME + asuid.${CUSTOM_DOMAIN} TXT)"
fi

# Get the URL
FQDN=$(az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "=== Deployed ==="
echo "MCP endpoint: https://${FQDN}/mcp"
echo "Health check: https://${FQDN}/health"
echo ""
echo "Developers connect with:"
echo '  { "mcpServers": { "tide": { "url": "https://'${FQDN}'/mcp" } } }'
