FROM node:alpine

WORKDIR /app

# Copy package files, install all deps (need typescript for build), build, then prune
COPY mcp-server/package.json mcp-server/package-lock.json ./mcp-server/
COPY mcp-server/src/ ./mcp-server/src/
COPY mcp-server/tsconfig.json ./mcp-server/
RUN cd mcp-server && npm ci && npm run build && npm prune --omit=dev

# Copy content directories
COPY canon/ ./canon/
COPY playbooks/ ./playbooks/
COPY skills/ ./skills/
COPY prompts/ ./prompts/
COPY adapters/ ./adapters/
COPY reference-apps/ ./reference-apps/
# templates/ and the DPoP checker are what the asset tools READ and what /pack/* serves. Leaving them
# out made tide_dpop_asset, tide_branding and tide_onboarding return errors on the hosted server.
COPY templates/ ./templates/
COPY scripts/check-dpop-asset.sh ./scripts/check-dpop-asset.sh
COPY GAP_REGISTER.md ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "mcp-server/dist/http.js"]
