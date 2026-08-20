# No Keycloak page after a Tide sign-up

> **New realms already have this off.** `templates/shared/bootstrap-tidecloak.sh` and the app
> templates' `init-tidecloak.sh` disable the first-broker-login profile page as **Step 3b/4b**,
> before `toggle-iga`, and fail the bootstrap if the read-back does not say `off`. The scripts here
> are for realms created **before** that, or by some other route.
>
> The order is load-bearing: after IGA is enabled the same write is a governed admin write, so it
> returns `202` and sits as a pending change request instead of applying.


Tide asserts only a username (the vuid) — no email, no name. Depending on how the realm was created,
Keycloak may stop the user with an Account Information form before they ever reach your app.

## Do this in order

```bash
# 1. Find out WHICH mechanism fires. Read-only, changes nothing.
bash diagnose-post-signup-page.sh --realm "$REALM"

# 2. Fix the one it reports. If it is idp-review-profile:
bash skip-review-profile.sh --realm "$REALM"

# 3. Collect the real details in your app afterwards.
#    See ONBOARDING.md — and do not invent a placeholder email (AP-85).
```

**Do not skip step 1.** Four different mechanisms produce a similar-looking form and each has a
different fix:

| Mechanism | Symptom | Fix |
|---|---|---|
| `idp-review-profile` | first login only | `skip-review-profile.sh`, or make the attributes optional |
| `VERIFY_PROFILE` | **every** login while incomplete | disable the required action |
| default required actions | one page per action, on every new user | clear `defaultAction` |
| a stale action on an existing user | that one user is stuck | `PUT /users/{id}` with `requiredActions: []` — no realm-level change clears it |

A correctly provisioned Tide realm has **none** of these active. VERIFIED read-only against a live
Tide realm (2026-08-20): only `link-tide-account-action` and `idp_link` are enabled, both
non-default, and no user-profile attribute is required. If the diagnostic reports "nothing will fire"
and you still land on a Keycloak page, it is probably the **account console** — a redirect-URI
problem, not a form. The URL tells you which:

```
/realms/{realm}/login-actions/required-action?...   required action
/realms/{realm}/login-actions/first-broker-login    idp-review-profile
/realms/{realm}/account/...                         account console -> fix the redirect
```

## Why the page appears at all

Not a Tide bug and not misconfiguration — it is the stock Keycloak default meeting an IdP that
asserts only an identifier:

```java
// TideIdentityProvider — the whole identity Tide asserts
identity.setUsername(userId);      // the vuid. No email, no firstName, no lastName.

// IdpReviewProfileAuthenticator.requiresUpdateProfilePage() — default mode is "missing"
profileProvider.create(UserProfileContext.IDP_REVIEW, userCtx.getAttributes()).validate();
return false;                      // no page
} catch (ValidationException pve) {
return true;                       // the page
```

So any **required** user-profile attribute fails validation and renders the form.

⚠️ Setting `updateProfileFirstLoginMode` on the identity provider does **nothing**. That field is
legacy, kept for importing old realms; the runtime check reads the **authenticator** config. It is
the obvious thing to try and it silently has no effect.

⚠️ `first broker login` is a **built-in flow shared by every IdP in the realm**. With more than one
IdP, copy the flow and bind the copy to the Tide IdP instead of editing the shared one.
`skip-review-profile.sh` warns when it finds more than one.

The user is still created either way: `IdpCreateUserIfUniqueAuthenticator` calls
`session.users().addUser(realm, username)` with **no** User Profile validation, so an account with no
email is created cleanly.

## Verification

`diagnose-post-signup-page.sh` was run read-only against a live Tide realm and correctly reported
that nothing would fire. `skip-review-profile.sh` reads its change back and fails if the value did
not stick — a `2xx` is not proof. Both refuse to run without credentials in the environment (AP-41)
and both fail loudly on a bad realm, URL, or mode.

The `authenticationConfig` object usually **already exists** on a stock realm (measured: alias
`"review profile config"`, value `"missing"`), so the update path is a `PUT` to the existing config,
not a `POST` of a new one. A script that only POSTs fails on every real realm.
