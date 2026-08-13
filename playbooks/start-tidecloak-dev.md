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

### Step 1: Image

**Always use `tideorg/tidecloak-dev:latest`.** Despite the `-dev` suffix, this **is** the production image — it carries the full Tide protocol and is the only image the pack supports, for development and production alike.

Do **not** use `tideorg/tidecloak-stg-dev`. That is an internal pre-release/staging build: it lags or leads production unpredictably, and it requires ORK, threshold and payer configuration to be supplied by hand, which is an easy way to end up on a broken threshold config. If you believe you need it, you are testing unreleased Tide behaviour — coordinate with the Tide team rather than reaching for it from a playbook.

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

No ORK/threshold/payer env vars are needed — the image ships with working defaults. Do not add them.

```bash
sudo docker run -d --name tidecloak \
  -v "$(pwd)/data:/opt/keycloak/data/h2" \
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
- **Do not** use `tideorg/tidecloak-stg-dev` or any `-stg` image. `tideorg/tidecloak-dev:latest` is the production image and the only supported one.
- **Do not** set `SYSTEM_HOME_ORK`, `USER_HOME_ORK`, `THRESHOLD_T`, `THRESHOLD_N` or `PAYER_PUBLIC`. The image has working defaults; overriding them by hand risks a broken threshold configuration.
- **Do not** use `THRESHOLD_T=1` anywhere. Single-ORK compromise.
- **Do not** reuse data directory across environments. Clean between setups.

---

## Next Step

Proceed to playbook `bootstrap-realm-from-template`.
