# Start TideCloak for Development

Start a TideCloak container for local development. This produces a running server — no realm, no client, no admin user yet.

---

## When to Use

- First step of any TideCloak bootstrap
- Rebuilding a local TideCloak after a wipe
- Need a clean TideCloak for testing

**Do not use** if TideCloak is already running and healthy. Check: `curl -sf http://localhost:8080 > /dev/null && echo "Running"`.

---

## Prerequisites

- Docker installed and running (`docker info` succeeds)
- `sudo` access (data directory permissions)
- Port 8080 available (or adjust mapping)

---

## Steps

### Step 1: Choose image

| Need | Image |
|------|-------|
| Standard development and production | `tideorg/tidecloak-dev:latest` |
| Staging / testing pre-release features | `tideorg/tidecloak-stg-dev:latest` |

Both images include the full Tide protocol. `tidecloak-dev` is the production image. `tidecloak-stg-dev` is the development/staging image for testing.

**Do not append `start-dev` or any command** to `docker run`. TideCloak images have a pre-configured entrypoint. Appending `start-dev` (a vanilla Keycloak convention) breaks Tide initialization.

### Step 2: Clean previous state

```bash
docker stop tidecloak 2>/dev/null; docker rm tidecloak 2>/dev/null
mkdir -p ./data
sudo rm -f ./data/keycloakdb* 2>/dev/null
sudo chown -R 1000:1000 ./data
```

Check port conflict:
```bash
lsof -i :8080 >/dev/null 2>&1 && echo "ERROR: Port 8080 in use" && exit 1
```

### Step 3: Start container

**Dev image (recommended for development):**

No ORK/threshold env vars needed — the dev image has built-in defaults.

```bash
sudo docker run -d --name tidecloak \
  -v "$(pwd)/data:/opt/keycloak/data/h2" \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
  tideorg/tidecloak-dev:latest
```

**Staging image (pre-release testing only):**

Requires ORK, threshold, and payer config.

```bash
sudo docker run -d --name tidecloak \
  -v "$(pwd)/data:/opt/keycloak/data/h2" \
  -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
  -e KC_HOSTNAME="${TIDECLOAK_URL:-http://localhost:8080}" \
  -e SYSTEM_HOME_ORK=https://sork1.tideprotocol.com \
  -e USER_HOME_ORK=https://sork1.tideprotocol.com \
  -e THRESHOLD_T=3 \
  -e THRESHOLD_N=5 \
  -e PAYER_PUBLIC=20000011d6a0e8212d682657147d864b82d10e92776c15ead43dcfdc100ebf4dcfe6a8 \
  tideorg/tidecloak-stg-dev:latest
```

### Step 4: Wait for readiness

```bash
for i in {1..15}; do
  curl -sf http://localhost:8080 > /dev/null 2>&1 && echo "TideCloak ready" && break
  echo "Waiting (attempt $i/15)..."
  sleep 5
done
```

TideCloak typically takes 30–60 seconds to start. If it does not respond after 15 attempts, check `docker logs tidecloak`.

---

## Verification

- [ ] `docker ps` shows `tidecloak` running
- [ ] `curl -sf http://localhost:8080` returns 200
- [ ] `docker logs tidecloak` shows no fatal errors

---

## Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| Container exits immediately | Stale H2 DB files | `sudo rm -f ./data/keycloakdb*` and restart |
| `AccessDeniedException` in logs | Wrong data directory mount or permissions | Mount `./data` not `.`, run `sudo chown -R 1000:1000 ./data` |
| Port already in use | Another container or service on 8080 | `docker rm -f $(docker ps -q --filter publish=8080)` |
| Exit code 2, HTTPS warnings | Named volume from previous docker-compose | `docker volume rm <volume_name>`, use fresh `./data` |

---

## Anti-Patterns

- **Do not** mount project root as data volume. Use `./data` subdirectory.
- **Do not** omit Tide env vars (`SYSTEM_HOME_ORK`, `USER_HOME_ORK`, etc.) when using the staging image. The dev image has built-in defaults and does not need them.
- **Do not** use `THRESHOLD_T=1` anywhere. Single-ORK compromise.
- **Do not** reuse data directory across environments. Clean between setups.

---

## Next Step

Proceed to playbook `bootstrap-realm-from-template`.
