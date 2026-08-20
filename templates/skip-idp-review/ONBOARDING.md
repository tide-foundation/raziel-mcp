# Collect profile details in your app, not in Keycloak's form

Once the post-signup page is gone, new users exist with **username = vuid** and nothing else. That is
the correct state to be in — now collect what you actually need, in your own UI, at a moment that
suits the user.

## Do NOT prefill with a generated email

The tempting move is to synthesise something unique — `user-a3f9c2@example.invalid` — so the profile
looks complete. Don't. Four concrete reasons, not style preferences:

1. **It is indistinguishable from a real address downstream.** Every later system — billing, support,
   a marketing export, an incident notification — treats it as a contact. Someone eventually mails
   it. If the domain is real (or becomes real), that is a data leak to a stranger.
2. **It collides.** Keycloak enforces email uniqueness unless `duplicateEmailsAllowed` is true
   (measured: `false` on a live Tide realm). A generator with a bug, or a re-run after a partial
   signup, produces duplicates that fail user creation with an error that does not mention email.
3. **It poisons the field you later need.** When the user finally supplies a real address you must
   distinguish "never set" from "set to junk". An empty field carries that information for free; a
   plausible-looking fake destroys it.
4. **Tide does not need it for recovery.** Password reset happens in the Secure Web Enclave, not by
   email link. The usual reason to demand an email at signup does not apply here.

**Leave it empty.** An empty email is honest, queryable (`email == null`), and costs nothing.

The username needs no generation either — the vuid is already unique and stable.

## Detect an incomplete profile

The vuid is in the token; a display name is not. Treat "no name" as the signal:

```ts
import { useTideCloak } from "@tidecloak/nextjs";

const { getValueFromToken, authenticated } = useTideCloak();

// `getValueFromToken` — NOT `tokenParsed`, which does not exist on the context.
const needsOnboarding =
  authenticated && !getValueFromToken("name") && !getValueFromToken("given_name");
```

If you need it server-side, read the same claims off the verified token — never trust a client flag.

## Write the details back

**Use the Account API with the user's own token. Do not use the Admin API from your backend.**

```ts
// PATH: the user acting on themselves. No admin credentials anywhere near your app.
await fetch(`${TIDECLOAK_URL}/realms/${REALM}/account/`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,       // the user's own access token
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ firstName, lastName, email }),
});
```

Two reasons this is the right path, one of them Tide-specific:

- **The Admin API needs admin credentials in your app**, which is AP-41 — those are bootstrap
  secrets and must never reach application runtime.
- **An admin write on a governed realm is captured by IGA.** Governed admin writes return `202
  Accepted` and create a change request that needs approval, so a "save profile" button would appear
  to succeed and silently change nothing until someone approves it in the enclave. A user editing
  their own profile through the Account API is not an admin write.

  ⚠️ **INFERRED, not verified.** The pack has confirmed that admin writes are captured and that
  `CREATE_USER` is a real action type; it has **not** been runtime-tested whether a self-service
  Account API profile update creates a change request on an IGA-enabled realm. Test it on your realm
  before shipping: submit the form, then check `GET /iga/change-requests` for a new entry. If one
  appears, the field is governed and needs the approve→commit loop.

The `account` client is enabled and public by default (measured on a live Tide realm), so the token
your app already holds can call it — check the audience if you get a 401.

## Make it skippable

The whole point of moving this out of Keycloak is that Keycloak's version is a **wall**: the user
cannot reach your app until they fill it in. Reproducing that as a blocking modal wastes the change.

- Let them dismiss it and use the app.
- Ask again later, or put it in settings with a gentle prompt.
- Only block on a field your app genuinely cannot function without — and if there is one, be honest
  that it is required rather than styling it as optional.

## Verify

```bash
# The realm no longer renders a form after signup:
bash diagnose-post-signup-page.sh --realm "$REALM"     # expect: nothing will fire

# A freshly signed-up user has a vuid username and no email:
curl -s "$URL/admin/realms/$REALM/users?max=5" -H "Authorization: Bearer $T" \
  | jq -c '.[] | {username, email, firstName, requiredActions}'

# After the user completes your modal, the same query shows the real values — and if the realm is
# IGA-governed, `GET /iga/change-requests` shows whether that write was captured.
```

## Anti-patterns

- **Generating a placeholder email** to make the profile look complete (AP-85, above).
- **Calling the Admin API from the app** to save a profile — admin credentials in runtime (AP-41),
  and possibly a silent change request.
- **A blocking modal.** You removed Keycloak's wall; do not rebuild it.
- **Trusting a client-side "profile complete" flag** for anything that matters. It is a UI hint.
- **Assuming the page is `idp-review-profile`.** Four different mechanisms produce a similar-looking
  form. Run `diagnose-post-signup-page.sh` and fix the one you actually have.
