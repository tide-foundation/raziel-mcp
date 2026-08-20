# Post-signup profile collection

Tide asserts **only a username** — the vuid. Keycloak fills that gap with its own
*Update Account Information* page, which **blocks the user before they reach your app**, on a screen
you cannot style, showing them a 64-hex username:

```
localhost:8082/realms/vialproof/login-actions/first-broker-login?...
   Username *  6fe7e7739ef028e2163c1cdcbb4ff78cd7c0588b70…
   Email *     ____________________
```

Two steps to replace it:

```bash
# 1. Turn the Keycloak page off (diagnose first — four mechanisms can cause it)
bash ../skip-idp-review/diagnose-post-signup-page.sh --realm "$REALM"
bash ../skip-idp-review/skip-review-profile.sh --realm "$REALM"

# 2. Drop the modal into your app
cp ProfileOnboarding.tsx <your-app>/components/
```

```tsx
<ProfileOnboarding baseUrl={cfg["auth-server-url"]} realm={cfg.realm} />
```

## Ask the user first

**Do not add this silently and do not skip it silently.** Ask once:

> After someone signs up, Tide gives you a unique account with no name or email attached. Want me to
> add a small in-app form so users can fill those in — and which fields do you actually need?
>
> - **first name / last name** — for greeting them and showing authorship
> - **email** — only if you send mail; Tide does **not** need it for account recovery
> - **none** — the vuid is enough, skip it entirely

Only ask for fields the app will actually use. Every field is a reason for someone to abandon signup.

## Three rules the component follows

| Rule | The failure it avoids |
|---|---|
| Writes via the **Account API with the user's own token** | The Admin API puts admin credentials in app runtime (AP-41), and on a governed realm an admin write returns `202` and queues a change request — so "Save" appears to work and changes nothing until a human approves it in the enclave |
| **Dismissible** by default | You removed Keycloak's wall; rebuilding it in your own UI gains nothing |
| **Never invents a placeholder email** | AP-85 — a synthetic address is indistinguishable from a real one downstream, collides with Keycloak's email uniqueness (`duplicateEmailsAllowed: false`), and destroys the "never set" signal |

It also uses `getValueFromToken(key)`, **not** `tokenParsed` — that property does not exist on
`TideCloakContextValue` and returns `undefined` silently, so the modal would simply never appear and
nothing would tell you why.

## Two responses it handles explicitly

- **401/403** — nearly always the `account` audience missing from the token, not a real permission
  problem. The message says so instead of "failed".
- **202 Accepted** — should not happen on the Account API. If it does, the write was captured by IGA
  and is *pending approval*. The component surfaces that rather than showing a success that saved
  nothing. This is the case worth watching: whether a self-service profile update is governed is
  **INFERRED, not verified** — see below.

## Verify

```bash
# The Keycloak page is gone:
bash ../skip-idp-review/diagnose-post-signup-page.sh --realm "$REALM"   # expect: nothing will fire

# A new user really is bare:
curl -s "$URL/admin/realms/$REALM/users?max=5" -H "Authorization: Bearer $T" \
  | jq -c '.[] | {username, email, firstName}'

# After the modal saves, the same query shows real values.
# On an IGA realm, confirm the write was NOT captured:
curl -s "$URL/realms/$REALM/iga/change-requests" -H "Authorization: Bearer $T" | jq '.[].actionType'
```

⚠️ That last check is the open question. The pack has verified that **admin** writes are captured and
that `CREATE_USER` is a real action type; it has **not** runtime-tested whether a **self-service**
Account API profile update creates a change request on an IGA-enabled realm. Run it on your realm
before shipping. If a CR appears, the field is governed and needs the approve→commit loop — the
component already refuses to report success in that case.

## Anti-patterns

- **Asking for fields you will never use.** Every one is a reason to abandon signup.
- **Making it blocking** without a domain reason. If a field truly is required, say so plainly rather
  than styling it as optional.
- **Calling the Admin API from the app** to save a profile.
- **Generating a placeholder email** so the profile "looks complete" (AP-85).
- **Trusting a client-side "profile complete" flag** for anything that matters — it is a UI hint.
