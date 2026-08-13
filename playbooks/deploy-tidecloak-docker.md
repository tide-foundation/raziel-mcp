# Deploy TideCloak with Docker and Auto-Initialize

Deploy TideCloak in Docker, auto-initialize a realm with Tide licensing, IGA, admin creation, and adapter config export.

---

## When to Use

- Setting up TideCloak for the first time on a development or staging machine
- Automating realm creation instead of clicking through the Admin Console
- Need a repeatable, scriptable TideCloak deployment for CI or onboarding
- Rebuilding a TideCloak instance from scratch after a wipe

**Do not use** if:
- You already have a running TideCloak with a configured realm (use Admin Console or API directly)
- You are deploying to production with an external database (this playbook covers H2-backed dev/staging only)

---

## Prerequisites

### Tools

- Docker installed and running (`docker info` succeeds)
- `curl` installed
- `jq` installed
- `lsof` installed (for port conflict detection)
- `sudo` access (for data directory permissions)

### Network

- Port 8080 available on the host (or change mapping)
- Internet access to pull the `tideorg/tidecloak-dev` image
- Internet access to reach the Tide ORK network (required for licensing and all Tide operations)

### Image

**Always `tideorg/tidecloak-dev:latest`.** Despite the `-dev` suffix this **is** the production image, and it is the only image the pack supports.

| Image | Use | Database | Tide Network |
|-------|-----|----------|--------------|
| `tideorg/tidecloak-dev:latest` | **All uses** — development and production | H2 (embedded) | Connected, via built-in defaults |
| `tideorg/tidecloak-stg-dev:latest` | **Not supported.** Internal pre-release build | — | — |

It ships working ORK/threshold/payer defaults, so the full Tide protocol — licensing, IGA approval flows, admin invite links, E2EE — works out of the box with **no** ORK env vars. VERIFIED 2026-08-06: `setUpTideRealm` on this image returns 200 with a real gVRK and free-tier subscription in ~7s.

Do not set `SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N` or `PAYER_PUBLIC` by hand — overriding the defaults risks a broken threshold configuration.

Note the embedded H2 database: for a real production deployment ask Tide about external-database configuration, or use a managed instance (`playbooks/provision-tidecloak-skycloak.md`).

**Do not append `start-dev` or any command** to `docker run`. TideCloak images have a pre-configured entrypoint. Appending `start-dev` (a vanilla Keycloak convention) breaks Tide initialization.

---

## Environment Variables

| Variable | Purpose | Example | Required For |
|----------|---------|---------|--------------|
| `KC_BOOTSTRAP_ADMIN_USERNAME` | Initial admin user | `admin` | Both images |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | Initial admin password | `password` | Both images |
| `KC_HOSTNAME` | Public-facing URL | `https://auth.myapp.com` | Staging only |
| `SYSTEM_HOME_ORK` | Tide network entry point | `https://sork1.tideprotocol.com` | Staging only |
| `USER_HOME_ORK` | User-facing ORK URL | `https://sork1.tideprotocol.com` | Staging only |
| `THRESHOLD_T` | Signing threshold | `3` | Staging only |
| `THRESHOLD_N` | Total ORK nodes | `5` | Staging only |
| `PAYER_PUBLIC` | Payer ORK public key | hex string | Staging only |
| `KC_PROXY_HEADERS` | Trust forwarded headers from reverse proxy | `xforwarded` | Behind reverse proxy only |

---

## Exact Step Sequence

### Step 1: Start TideCloak (Development)

For local development without Tide network connection:

```bash
mkdir -p ./data
sudo docker run -d \
  --name tidecloak \
  -v ./data:/opt/keycloak/data/h2 \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}" \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  tideorg/tidecloak-dev:latest
```

> ⚠️ **The admin password comes from `.env`, never from a script or the command line.** Copy
> `templates/shared/.env.template` → `.env` (gitignored), set `KC_BOOTSTRAP_ADMIN_PASSWORD`, and let the
> shell expand it as above. A literal `KC_BOOTSTRAP_ADMIN_PASSWORD=password` is a hardcoded credential
> that also lands in shell history, CI logs and `ps` output (AP-41). Bootstrap scripts must **fail
> loudly** when it is unset — a default password is a hardcoded credential with extra steps.

---

### Step 1 (Alternative): Start TideCloak (Staging)

For staging with full Tide protocol:

```bash
mkdir -p ./data
docker run -d \
  --name tidecloak \
  -v ./data:/opt/keycloak/data/h2 \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}" \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  -e KC_HOSTNAME=https://auth.myapp.com \
  tideorg/tidecloak-dev:latest
```

**Important:** Always mount a dedicated `data/` subdirectory, not the project root (`.`). Mounting the project root causes H2 database permission errors (`AccessDeniedException`) because the container writes DB files as a different user than your project files.

---

### Step 2: Create the realm.json Template

Create a file named `realm.json` in your working directory. This template is used by the auto-initialization script.

**CRITICAL:** This template must be used exactly as shown. Do not create a minimal version. Every section is required for Tide to initialize correctly. Missing `requiredActions` causes invite link failures. Missing `authenticationFlows` causes login failures. Missing `protocolMappers` causes missing claims in JWTs.

Replace `REALM_NAME` and `CLIENT_NAME` with your values. Replace `CLIENT_APP_URL` with your app's URL. The init script performs these replacements automatically via `sed`.

```json
{
  "realm": "REALM_NAME",
  "accessTokenLifespan": 600,
  "enabled": true,
  "sslRequired": "external",
  "registrationAllowed": false,
  "duplicateEmailsAllowed": true,
  "roles": {
    "realm": [
      { "name": "appUser", "description": "Standard application user" },
      { "name": "_tide_enabled", "description": "Represents a tide user thats allowed perform actions on tide" },
      {
        "name": "default-roles-REALM_NAME",
        "description": "${role_default-roles}",
        "composite": true,
        "composites": { "realm": ["_tide_enabled", "appUser"] }
      }
    ],
    "client": { "CLIENT_NAME": [] }
  },
  "defaultRole": {
    "name": "default-roles-REALM_NAME",
    "description": "${role_default-roles}",
    "composite": true,
    "clientRole": false
  },
  "clients": [
    {
      "clientId": "CLIENT_NAME",
      "enabled": true,
      "redirectUris": [
        "CLIENT_APP_URL",
        "CLIENT_APP_URL/*",
        "CLIENT_APP_URL/silent-check-sso.html",
        "CLIENT_APP_URL/auth/redirect"
      ],
      "webOrigins": ["CLIENT_APP_URL"],
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "publicClient": true,
      "fullScopeAllowed": true,
      "protocolMappers": [
        {
          "name": "Tide User Key",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-usermodel-attribute-mapper",
          "consentRequired": false,
          "config": {
            "introspection.token.claim": "true",
            "userinfo.token.claim": "true",
            "user.attribute": "tideUserKey",
            "lightweight.claim": "true",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "claim.name": "tideuserkey",
            "jsonType.label": "String"
          }
        },
        {
          "name": "audience (self): CLIENT_NAME",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-audience-mapper",
          "config": {
            "included.client.audience": "CLIENT_NAME",
            "access.token.claim": "true",
            "id.token.claim": "false"
          }
        },
        {
          "name": "Tide vuid",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-usermodel-attribute-mapper",
          "consentRequired": false,
          "config": {
            "introspection.token.claim": "true",
            "userinfo.token.claim": "true",
            "user.attribute": "vuid",
            "lightweight.claim": "true",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "claim.name": "vuid",
            "jsonType.label": "String"
          }
        }
      ]
    }
  ],
  "components": {
    "org.keycloak.userprofile.UserProfileProvider": [
      {
        "providerId": "declarative-user-profile",
        "config": {
          "kc.user.profile.config": [
            "{\"attributes\":[{\"name\":\"username\",\"displayName\":\"${username}\",\"validations\":{\"length\":{\"min\":3,\"max\":255},\"username-prohibited-characters\":{},\"up-username-not-idn-homograph\":{}},\"permissions\":{\"view\":[\"admin\",\"user\"],\"edit\":[\"admin\",\"user\"]},\"multivalued\":false},{\"name\":\"email\",\"displayName\":\"${email}\",\"validations\":{\"email\":{},\"length\":{\"max\":255}},\"permissions\":{\"view\":[\"admin\",\"user\"],\"edit\":[\"admin\",\"user\"]},\"multivalued\":false},{\"name\":\"firstName\",\"displayName\":\"${firstName}\",\"permissions\":{\"view\":[\"admin\",\"user\"],\"edit\":[\"admin\",\"user\"]},\"multivalued\":false},{\"name\":\"lastName\",\"displayName\":\"${lastName}\",\"permissions\":{\"view\":[\"admin\",\"user\"],\"edit\":[\"admin\",\"user\"]},\"multivalued\":false}],\"groups\":[{\"name\":\"user-metadata\",\"displayHeader\":\"User metadata\",\"displayDescription\":\"Attributes, which refer to user metadata\"}],\"unmanagedAttributePolicy\":\"ENABLED\"}"
          ]
        }
      }
    ]
  },
  "authenticationFlows": [
    {
      "alias": "tidebrowser",
      "providerId": "basic-flow",
      "topLevel": true,
      "authenticationExecutions": [
        {
          "authenticator": "auth-cookie",
          "authenticatorFlow": false,
          "requirement": "ALTERNATIVE",
          "priority": 10,
          "userSetupAllowed": false
        },
        {
          "authenticatorConfig": "tide browser",
          "authenticator": "identity-provider-redirector",
          "authenticatorFlow": false,
          "requirement": "ALTERNATIVE",
          "priority": 25,
          "userSetupAllowed": false
        }
      ]
    }
  ],
  "authenticatorConfig": [
    {
      "alias": "tide browser",
      "config": { "defaultProvider": "tide" }
    }
  ],
  "browserFlow": "tidebrowser",
  "requiredActions": [
    {
      "alias": "link-tide-account-action",
      "name": "Link Tide Account",
      "providerId": "link-tide-account-action",
      "enabled": true
    },
    {
      "alias": "UPDATE_PASSWORD",
      "name": "Update Password",
      "providerId": "UPDATE_PASSWORD",
      "enabled": false
    }
  ]
}
```

---

### Step 3: Run the Auto-Initialization Script

This script automates the full realm setup: container launch, realm creation, Tide licensing, IGA enablement, admin user creation, invite link generation, change request approval, IdP configuration, and adapter config export.

**Initialization sequence order (never skip or reorder):**

1. Clean up previous state
2. Start container
3. Wait for TideCloak readiness
4. Get admin token
5. Create realm from template
6. Initialize Tide realm + enable IGA
7. Approve client change requests
8. Create admin user
9. Approve user creation change request (user is not queryable until committed)
10. Assign `tide-realm-admin` role (validate role lookup succeeds)
11. Generate invite link (admin links their Tide account)
12. Wait for admin to link their Tide account
13. Approve role assignment change requests
14. Update CustomAdminUIDomain for enclave approval popups
15. Download adapter config

Save the following as `init-tidecloak.sh`:

```bash
#!/bin/bash
# Configuration
TIDECLOAK_URL="${TIDECLOAK_LOCAL_URL:-http://localhost:8080}"
CLIENT_APP_URL="${CLIENT_APP_URL:-http://localhost:3000}"
REALM_NAME="${NEW_REALM_NAME:-myapp}"
CLIENT_NAME="${CLIENT_NAME:-myclient}"
ADAPTER_OUTPUT="./data/tidecloak.json"

# 0. Clean up any previous state
#    - Stop and remove existing container (if any)
#    - Remove stale H2 database files (cause "Could not open file" errors)
#    - Fix directory permissions (container runs as UID 1000)
#    - Handle port conflicts
docker stop tidecloak 2>/dev/null
docker rm tidecloak 2>/dev/null
mkdir -p ./data
sudo rm -f ./data/keycloakdb* 2>/dev/null
sudo chown -R 1000:1000 ./data

# Check if port 8080 is already in use
if lsof -i :8080 >/dev/null 2>&1; then
  echo "ERROR: Port 8080 is already in use. Stop the existing service or change the port."
  exit 1
fi

# tideorg/tidecloak-dev IS the production image. It ships working ORK/threshold/payer
# defaults — do NOT set SYSTEM_HOME_ORK, USER_HOME_ORK, THRESHOLD_T/N or PAYER_PUBLIC.
sudo docker run -d --name tidecloak \
  -v "$(pwd)/data:/opt/keycloak/data/h2" \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME="${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}" \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  tideorg/tidecloak-dev:latest

if [ $? -ne 0 ]; then
  echo "ERROR: Docker failed to start. Check 'docker logs tidecloak' for details."
  exit 1
fi

# 1. Wait for TideCloak to be ready
for i in {1..15}; do
  curl -s -f "$TIDECLOAK_URL" > /dev/null 2>&1 && break
  echo "Waiting for TideCloak (attempt $i/15)..."
  sleep 5
done

# 2. Get admin token
get_token() {
  curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=admin&password=password&grant_type=password&client_id=admin-cli" \
    | jq -r '.access_token'
}

# 3. Create realm from template
#    Replace placeholders in realm.json with actual values
TMP_REALM="$(mktemp)"
cp realm.json "$TMP_REALM"
sed -i "s|REALM_NAME|$REALM_NAME|g" "$TMP_REALM"
sed -i "s|CLIENT_NAME|$CLIENT_NAME|g" "$TMP_REALM"
sed -i "s|CLIENT_APP_URL|$CLIENT_APP_URL|g" "$TMP_REALM"

TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @"$TMP_REALM"
rm -f "$TMP_REALM"

# 4. Initialize Tide realm + enable IGA
TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/setUpTideRealm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "email=admin@yourorg.com" \
  --data-urlencode "isRagnarokEnabled=true"

# Stamp iga.attestor=tide on the realm BEFORE enabling IGA so governance comes
# up in Tide (cryptographic) mode rather than Tideless.
REALM_REP=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME" -H "Authorization: Bearer $TOKEN")
UPDATED_REALM=$(echo "$REALM_REP" | jq '.attributes = ((.attributes // {}) + {"iga.attestor":"tide"})')
curl -s -X PUT "$TIDECLOAK_URL/admin/realms/$REALM_NAME" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "$UPDATED_REALM"

curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tide-admin/toggle-iga" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "isIGAEnabled=true"

# 5. Auto-approve change requests created during realm setup.
#    Uses the current /iga/change-requests/... surface (replaces the legacy
#    /tide-admin/change-set/... surface). During bootstrap the realm is in
#    FirstAdmin/Tideless mode, so authorize signs server-side (no enclave).
#    See canon/iga-change-requests-api.md.
approve_all_pending() {
  local TOKEN ready id

  # 1. Authorize every pending CREATE/DELETE change request in one call.
  TOKEN="$(get_token)"
  # NOTE: do NOT use bulk-authorize with actionTypeIn:["CREATE","DELETE"] — those are
  # not real action-type values (real ones are CREATE_USER, DELETE_REALM,
  # UPDATE_PROTOCOL_MAPPER, ADOPT_SCOPE_MAPPING, GRANT_ROLES, ...). That filter matches
  # nothing and silently authorizes ZERO CRs with a 200. Omitting the filter returns 400.
  # Authorize each pending CR individually instead. VERIFIED 2026-08-06.
  # See canon/iga-change-requests-api.md.
  ids=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null \
    | jq -r 'if type=="array" then .[].id else empty end' 2>/dev/null)
  for id in $ids; do
    TOKEN="$(get_token)"
    curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/$id/authorize" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' > /dev/null 2>&1 || true
  done

  # 2. Commit everything that is ready. Loop passes so dependent CRs
  #    (e.g. a role must exist before its assignment) become ready and commit.
  for pass in 1 2 3 4 5; do
    TOKEN="$(get_token)"
    ready=$(curl -s "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests?status=PENDING" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null \
      | jq -r '.[] | select(.readyToCommit==true) | .id' 2>/dev/null)
    [ -z "$ready" ] && break
    for id in $ready; do
      TOKEN="$(get_token)"
      curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/iga/change-requests/$id/commit" \
        -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
    done
  done
}

approve_all_pending

# 6. Create admin user. tideInvitable + emailVerified:false mark the user as
#    pending Tide enrollment (the link-tide-account required action).
TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@yourorg.com","firstName":"Admin","lastName":"User","enabled":true,"emailVerified":false,"attributes":{"tideInvitable":["true"]}}'

# 6b. Approve user creation (user is not queryable until committed with IGA enabled)
sleep 2
approve_all_pending

# 6c. Assign tide-realm-admin role
# ORDERING: committing this grant flips the realm firstAdmin -> multiAdmin, after
# which no server-driven governed write may run. The canonical scaffolder grants
# tide-realm-admin LAST — after enrollment (step 8) and after the IdP settings are
# re-signed (step 10) — then does a final drain. For a fully firstAdmin-safe run,
# move this grant to after step 10 and add a final approve_all_pending.
TOKEN="$(get_token)"
USER_ID=$(curl -s -X GET "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=admin" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

if [ -z "$USER_ID" ] || [ "$USER_ID" = "null" ]; then
  echo "ERROR: Could not find admin user. Was the user change request approved?"
  exit 1
fi

CLIENT_UUID=$(curl -s -X GET "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=realm-management" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

ROLE_JSON=$(curl -s -X GET "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID/roles/tide-realm-admin" \
  -H "Authorization: Bearer $TOKEN")

if echo "$ROLE_JSON" | jq -e '.error' > /dev/null 2>&1; then
  echo "ERROR: tide-realm-admin role not found: $ROLE_JSON"
  exit 1
fi

TOKEN="$(get_token)"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users/$USER_ID/role-mappings/clients/$CLIENT_UUID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "[$ROLE_JSON]"

# 7. Generate invite link for admin to link their Tide account
TOKEN="$(get_token)"
INVITE_LINK=$(curl -s -X POST \
  "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tideAdminResources/get-required-action-link?userId=$USER_ID&lifespan=43200" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '["link-tide-account-action"]')

echo "Open this link to link your admin Tide account:"
echo "$INVITE_LINK"

# 8. Wait for admin to link their Tide account
while true; do
  TOKEN="$(get_token)"
  KEY=$(curl -s -X GET "$TIDECLOAK_URL/admin/realms/$REALM_NAME/users?username=admin" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.[0].attributes.tideUserKey[0] // empty')
  [ -n "$KEY" ] && break
  sleep 5
done

# 9. Approve role assignment change requests
sleep 2
approve_all_pending

# 10. Point the tide IdP at THIS realm's TideCloak console origin, then sign it.
#     CustomAdminUIDomain must be the TideCloak console origin for this realm
#     ({base}/realms/{realm}/tide-console/) so enclave approval popups target the
#     built-in console. sign-idp-settings is ALWAYS required after any Tide IDP
#     config change and needs healthy ORKs.
#     ORDERING: do this BEFORE granting tide-realm-admin (step below). Committing
#     that grant flips the realm firstAdmin -> multiAdmin, after which no
#     server-driven governed write may run.
TOKEN="$(get_token)"
TIDE_CONSOLE_ORIGIN="$TIDECLOAK_URL/realms/$REALM_NAME/tide-console/"
INST=$(curl -s -X GET "$TIDECLOAK_URL/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
  -H "Authorization: Bearer $TOKEN")
UPDATED=$(echo "$INST" | jq --arg d "$TIDE_CONSOLE_ORIGIN" '.config.CustomAdminUIDomain=$d')
curl -s -X PUT "$TIDECLOAK_URL/admin/realms/$REALM_NAME/identity-provider/instances/tide" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "$UPDATED"
curl -s -X POST "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/sign-idp-settings" \
  -H "Authorization: Bearer $TOKEN"

# 11. Download adapter config
TOKEN="$(get_token)"
CLIENT_UUID=$(curl -s -X GET "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')
curl -s -X GET "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/get-installations-provider?clientId=$CLIENT_UUID&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer $TOKEN" > "$ADAPTER_OUTPUT"

echo "Done! Adapter config saved to $ADAPTER_OUTPUT"
```

Make it executable and run:

```bash
chmod +x init-tidecloak.sh
./init-tidecloak.sh
```

Override defaults with environment variables:

```bash
TIDECLOAK_LOCAL_URL=http://localhost:8080 \
CLIENT_APP_URL=http://localhost:3000 \
NEW_REALM_NAME=myapp \
CLIENT_NAME=myclient \
./init-tidecloak.sh
```

---

### Step 4: Download Adapter Config

The init script saves the adapter config to `./data/tidecloak.json` automatically.

If you need to download it manually after initialization:

```bash
TIDECLOAK_URL="http://localhost:8080"
REALM_NAME="myapp"
CLIENT_NAME="myclient"

TOKEN=$(curl -s -X POST "$TIDECLOAK_URL/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=password&grant_type=password&client_id=admin-cli" \
  | jq -r '.access_token')

CLIENT_UUID=$(curl -s -X GET "$TIDECLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_NAME" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

curl -s -X GET "$TIDECLOAK_URL/admin/realms/$REALM_NAME/vendorResources/get-installations-provider?clientId=$CLIENT_UUID&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer $TOKEN" > ./data/tidecloak.json
```

---

## Key Initialization Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /admin/realms` | Create realm from JSON template |
| `POST /admin/realms/{realm}/vendorResources/setUpTideRealm` | Initialize Tide licensing + VRK |
| `POST /admin/realms/{realm}/tide-admin/toggle-iga` | Enable IGA governance |
| `POST /admin/realms/{realm}/iga/change-requests/{id}/authorize` | Approve (sign) a change request. Batch: `POST /iga/change-requests/bulk-authorize`. Replaces legacy `tide-admin/change-set/sign`. |
| `POST /admin/realms/{realm}/iga/change-requests/{id}/commit` | Commit an approved change. Replaces legacy `tide-admin/change-set/commit`. See `canon/iga-change-requests-api.md`. |
| `POST /admin/realms/{realm}/tideAdminResources/get-required-action-link` | Generate admin invite link |
| `GET /admin/realms/{realm}/vendorResources/get-installations-provider` | Download adapter config |
| `POST /admin/realms/{realm}/vendorResources/sign-idp-settings` | Sign IdP settings with VRK. **ALWAYS required** after any Tide IDP config change (logo, background, backup toggle, custom admin domain, or client origin changes). Without it, the enclave rejects settings as unsigned. Requires active VRK/license. |
| `POST /admin/realms/{realm}/tide-idp-admin-resources/images/upload` | Upload branding (logo/background) |

---

## Verification Checklist

### Container Running

```bash
docker ps --filter name=tidecloak
# Should show running container
```

### TideCloak Responds

```bash
curl -s -f http://localhost:8080
# Should return HTML (Keycloak welcome page)
```

### Admin Token Works

```bash
curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=password&grant_type=password&client_id=admin-cli" \
  | jq -r '.access_token'
# Should return a JWT string, not null
```

### Realm Exists

```bash
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=password&grant_type=password&client_id=admin-cli" \
  | jq -r '.access_token')

curl -s -X GET "http://localhost:8080/admin/realms/myapp" \
  -H "Authorization: Bearer $TOKEN" | jq '.realm'
# Should return "myapp"
```

### Adapter Config Downloaded

```bash
cat ./data/tidecloak.json | jq '.realm'
# Should return your realm name

cat ./data/tidecloak.json | jq '.resource'
# Should return your client name

cat ./data/tidecloak.json | jq '.["auth-server-url"]'
# Should return your TideCloak URL
```

### IGA Enabled

```bash
curl -s -X GET "http://localhost:8080/admin/realms/myapp" \
  -H "Authorization: Bearer $TOKEN" | jq '.attributes.isIGAEnabled'
# Should return "true"
```

---

## Common Failures

### Wrong Mount Path

**Symptom**: `AccessDeniedException` or `Could not open file` errors in `docker logs tidecloak`. H2 database files appear in the project root.

**Cause**: Mounted the project root (`.`) instead of a dedicated `data/` subdirectory. The container writes DB files as UID 1000, conflicting with your project file ownership.

**Fix**:
```bash
docker stop tidecloak && docker rm tidecloak
rm -f keycloakdb*          # Remove stale DB files from project root
mkdir -p ./data
sudo chown -R 1000:1000 ./data
# Restart with -v "$(pwd)/data:/opt/keycloak/data/h2"
```

---

### Permission Errors on Data Directory

**Symptom**: Container starts but crashes immediately. Logs show permission denied on `/opt/keycloak/data/h2`.

**Cause**: The `./data` directory is owned by root or your user, but the container process runs as UID 1000.

**Fix**:
```bash
sudo chown -R 1000:1000 ./data
```

---

### Port 8080 Already in Use

**Symptom**: `docker run` fails or container exits immediately. `docker logs tidecloak` shows bind error.

**Cause**: Another service (another TideCloak instance, a web server, Jenkins, etc.) is already using port 8080.

**Fix**:
```bash
# Find what is using the port
lsof -i :8080

# Either stop that service, or remap:
docker run -d --name tidecloak \
  -v "$(pwd)/data:/opt/keycloak/data/h2" \
  -p 9080:8080 \
  ...
# Then use TIDECLOAK_LOCAL_URL=http://localhost:9080
```

---

### Stale Volumes / Old Database State

**Symptom**: Realm creation fails with "realm already exists". Or Tide initialization returns unexpected errors. Or old users/clients appear from a previous run.

**Cause**: The `./data` directory contains H2 database files from a previous run.

**Fix**:
```bash
docker stop tidecloak && docker rm tidecloak
sudo rm -f ./data/keycloakdb*
sudo chown -R 1000:1000 ./data
# Restart the container
```

---

### Wrong Endpoint Paths

**Symptom**: `404 Not Found` from curl calls during initialization. Script silently fails at a step.

**Cause**: Incorrect URL construction. Common mistakes:
- Missing `/admin/` prefix on admin endpoints
- Using `/auth/` prefix (Keycloak < 17 pattern, not used by TideCloak)
- Wrong realm name in URL

**Fix**: Verify the endpoint paths from the Key Initialization Endpoints table above. TideCloak does not use the `/auth/` prefix. All admin endpoints start with `/admin/realms/{realm}/`.

---

### setUpTideRealm Fails or Hangs

**Symptom**: Container starts but Tide realm initialization (`setUpTideRealm`) fails or hangs. ORK-dependent operations time out.

**Causes, in order of likelihood**:
1. **Hand-set ORK/threshold env vars overriding the image defaults.** Remove `SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N` and `PAYER_PUBLIC` — `tidecloak-dev` supplies working values.
2. **Using a `-stg` image.** Unsupported; switch to `tideorg/tidecloak-dev:latest`.
3. **No outbound access to the Tide ORK network.** Licensing genuinely calls out. A healthy call takes ~7-15s; a sub-2s failure means it never made the request.

**Verify licensing works**: `setUpTideRealm` should return 200 with an `activationPackage` containing a `gVRK`. VERIFIED 2026-08-06 on `tidecloak-dev`.

---

### Admin Token Expired Mid-Script

**Symptom**: A curl call returns `401 Unauthorized` partway through initialization.

**Cause**: Admin tokens are short-lived. The script re-fetches tokens via `get_token()` before each group of calls, but long waits (e.g., waiting for admin to link their Tide account in step 8) can cause expiry.

**Fix**: The init script already calls `get_token()` before each major step. If you modify the script, always refresh the token before any API call that follows a wait or delay.

---

### Invite Link Expired or Missing

**Symptom**: The admin invite link returns an error page. Or `get-required-action-link` returns an empty response.

**Cause**: The `link-tide-account-action` required action is missing from `realm.json`, or the invite link lifespan (43200 seconds = 12 hours) has expired.

**Fix**: Verify `realm.json` includes the `requiredActions` section with `link-tide-account-action`. Regenerate the link:
```bash
TOKEN="$(get_token)"
curl -s -X POST \
  "$TIDECLOAK_URL/admin/realms/$REALM_NAME/tideAdminResources/get-required-action-link?userId=$USER_ID&lifespan=43200" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '["link-tide-account-action"]'
```

---

## Anti-Patterns

### Do Not Skip or Reorder Initialization Steps

The initialization sequence has strict ordering dependencies. Tide realm setup must happen before IGA enablement. Client change requests must be approved before admin user creation. User change requests must be approved after admin links their Tide account. Skipping or reordering steps causes silent failures or broken state.

---

### Do Not Minimize the realm.json Template

Every section in the template is required:
- `protocolMappers` -- without these, JWTs lack `tideuserkey`, `vuid`, and IGA role claims
- `authenticationFlows` + `authenticatorConfig` + `browserFlow` -- without these, login redirects to standard Keycloak login instead of Tide
- `requiredActions` -- without `link-tide-account-action`, admin invite links fail
- `roles` including `_tide_enabled` -- without this, Tide protocol features are disabled for users
- `components` (user profile) -- without this, user attributes behave incorrectly

---

### Do Not Use the Project Root as the Docker Volume Mount

```bash
# WRONG
docker run -v .:/opt/keycloak/data/h2 ...

# CORRECT
docker run -v ./data:/opt/keycloak/data/h2 ...
```

Mounting the project root causes H2 database files to be written alongside your source code with different ownership (UID 1000), leading to `AccessDeniedException` and polluted working directories.

---

### Do Not Hardcode Tokens

Admin tokens expire. Always call `get_token()` before each API call or group of calls. Do not capture a token once and reuse it across the entire script without refresh.

---

### Do Not Run the Init Script Against an Already-Initialized Realm

The script assumes a clean state. Running it twice creates duplicate users, fails on "realm already exists", or leaves change requests in an inconsistent state. If you need to re-initialize, clean up first:
```bash
docker stop tidecloak && docker rm tidecloak
sudo rm -f ./data/keycloakdb*
```

---

### Do Not Hand-Configure ORK/Threshold Env Vars

`tideorg/tidecloak-dev:latest` **is** connected to the Tide ORK network and supports the full Tide protocol out of the box — `setUpTideRealm`, licensing, IGA change-request signing, admin invite links and E2EE all work with no ORK environment variables. VERIFIED 2026-08-06: `setUpTideRealm` on this image returned 200 with a real gVRK and free-tier subscription in ~7s.

Setting `SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N` or `PAYER_PUBLIC` by hand overrides working defaults and risks a broken threshold configuration.

(An earlier version of this playbook claimed `tidecloak-dev` was not ORK-connected and that `tidecloak-stg-dev` was required for these features. That was incorrect.)

---

## References

- Source: operational exemplars: keylessh, forseti-crypto-quickstart, tidecloak-test-cases
- Reference scripts: keylessh `script/tidecloak/start.sh`, forseti-crypto-quickstart `init/tcinit.sh`, tidecloak-test-cases `tests/scripts/init-tidecloak.sh` + `handover-admin.sh`
- The tidecloak-test-cases `handover-admin.sh` provides a reusable CLI for admin setup: `-i` (invite link), `-c` (confirm linked), `-r` (assign role), `-a` (approve change-sets)
