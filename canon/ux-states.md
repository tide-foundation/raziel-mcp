# UX: States, Waits, and Copy

Tide has UX moments a developer will not anticipate from experience with ordinary OIDC: threshold operations take real time, some approvals open a popup, and role changes are not instant. If the app does not render these states, they surface as "it's broken".

This file covers what to render, what to say, and which waits are real. It is about the **end user's** experience of a Tide app — not the developer's.

**VERIFIED** against `@tidecloak/react` 0.14.17 type definitions unless tagged otherwise.

---

## The auth state machine

`useTideCloak()` exposes far more than `authenticated`. Handle each state or the user sees a blank screen at the worst moment.

| State | Meaning | Render |
|---|---|---|
| `isInitializing` | SDK starting, config loading | Skeleton or spinner. **Never** the logged-out view — it flashes "Sign in" at an authenticated user |
| `initError` | Provider failed to start (bad/missing adapter) | A real error, not a login button. This is a deploy fault, not a user fault |
| `authenticated: false` | Genuinely signed out | Sign-in |
| `isLoading` / `isRefreshing` | Token work in flight | Keep the current view. Do **not** unmount content — a refresh is background and mid-flight refreshes are normal |
| `sessionExpired` | Session ended | Explain and offer re-sign-in. Do not silently redirect and lose their work |
| `needsReauth` | Step-up required | Prompt via `triggerReauth()`; clear with `clearReauth()` |
| `isOffline` | Fabric unreachable | Disable Tide actions and say why. Encryption **cannot** work offline (I-11) |
| `wasOffline` | Recovered from offline | Optional "reconnected" cue; call `resetWasOffline()` after showing it |

```tsx
const { isInitializing, initError, authenticated, sessionExpired, isOffline } = useTideCloak();

if (isInitializing) return <Skeleton />;              // NOT the login screen
if (initError)      return <ConfigError error={initError} />;
if (sessionExpired) return <SessionExpired onSignIn={login} />;
if (!authenticated) return <SignIn onSignIn={login} />;
// isRefreshing: render normally, never blank the page
```

**The most common UX bug is treating `!authenticated` as "logged out".** While `isInitializing` is true, `authenticated` is also false — so a naive check flashes the sign-in screen on every page load for users who are already signed in.

### Provider callbacks — only on `TideCloakContextProvider`

The callbacks (`onAuthSuccess`, `onAuthError`, `onLogout`, `onReauthRequired`, `onActionNotification`) exist **only on `TideCloakContextProvider`**.

> ⚠️ **`TideCloakProvider` silently drops them.** Its runtime is
> `({ config, children }) => <InternalTideCloakProvider config={config} children={children}/>`
> (`@tidecloak/nextjs/dist/esm/contexts/TideCloakProvider.js`), and its props type is exactly
> `{ config, children }`. Passing `onActionNotification` to it is a TS excess-property error and,
> in JS, a no-op — your toasts never fire and it looks like the SDK is silent.
> VERIFIED against 0.14.17 on 2026-08-07 (an earlier revision of this file got this wrong).

`@tidecloak/nextjs` re-exports `TideCloakContextProvider`, so switch the import to use callbacks:

```tsx
import { TideCloakContextProvider } from '@tidecloak/nextjs';

<TideCloakContextProvider
  config={{ ...tcConfig, useDPoP: { mode: 'strict', alg: 'ES256' } }}
  onActionNotification={({ type, title, message }) => toast[type](message ?? title)}
>
```

`ActionNotification` is `{ type: 'success' | 'error' | 'info' | 'warning', title, message?, action? }`. Wire it once and approval/encryption progress surfaces automatically instead of looking like a hang.

**If you stay on `TideCloakProvider`** (config + children only), you get no callbacks — surface progress from the hook's own state (`isRefreshing`, `isOffline`, `needsReauth`) instead, and do not add the checklist item below.

---

## Waits that are real — budget for them

These are not slow code. They are threshold operations or governance, and no amount of optimisation removes them.

| Operation | Typical | Why | UX |
|---|---|---|---|
| Login | seconds | Threshold verification across ORKs | Progress, not a frozen button |
| `doEncrypt` / `doDecrypt` | ~a second, network-bound | ORK round trip | Per-item spinner; never block the whole page |
| Role visible after IGA commit | **up to 120s** | Token refresh cycle | See below — this one bites hardest |
| `setUpTideRealm` (bootstrap) | 10–15s | Real licensing call | Admin-only; show progress |
| Enclave approval | human-paced | Someone must approve | Show "waiting for approval", not a spinner that looks stuck |

### The 120-second role delay

After an IGA change request is committed, the role is **not** in the user's token until it refreshes — up to 120 seconds, or immediately on re-login. An app that assumes instant effect shows the user a permission error right after being granted permission.

Handle it explicitly:

- After granting, tell the user roles take up to two minutes, or offer "sign in again to apply now".
- When an operation fails on a missing role the user *should* have, say so and offer re-login — do not render a generic "access denied" that implies a mistake.

```tsx
catch (e) {
  if (/access to '.*'/.test(String(e?.message))) {
    setError("Your access is still being applied. Sign out and back in, or wait up to 2 minutes.");
  }
}
```

---

## Popups: enclave approvals

Admin approvals and policy signing open the Tide enclave in a **popup**. Popup blockers kill it silently — the user clicks and nothing happens.

- **Open it from a direct user gesture** (a click handler), never after an `await`. A popup opened in an async continuation is blocked by default.
- If it fails to open, say so and offer a retry button: "Your browser blocked the approval window. Allow popups for this site, then try again."
- While it is open, render "Waiting for approval in the Tide window" — not an indeterminate spinner.

ASSUMED (operator guidance): the popup-blocker copy above is not sourced from a Tide document; the popup requirement itself is VERIFIED (approval enclave, I-10).

---

## Encryption is online-only

E2EE requires live Fabric participation. There is no offline decrypt and no cached session key (I-11, AP-04).

Design for it rather than letting it fail:
- Gate encrypt/decrypt actions on `!isOffline`.
- Say "Encryption needs a connection" rather than showing a failed operation.
- Never build an "offline mode" that pretends to decrypt, and never cache plaintext to fake one.

---

## First-run and account linking

New users complete a **Tide account link** in the browser. This is enclave-gated by design and cannot be automated (see `initialize-admin-and-link-account`).

Make it feel like onboarding, not an error:
- Explain what is about to happen before sending them to the link.
- The link is single-purpose and time-limited — if it expires, say that and issue a new one rather than showing a generic failure.

---

## Shared encryption: gate the UI on the policy

Shared (Forseti) encryption does not work until an admin has signed the policy. If the app exposes a "share" mode before then, `IAMService.doEncrypt(data, policyBytes)` fails at runtime and looks like a bug.

Check for the signed policy and render the feature as **not yet available**, with the admin action named. See the automation boundary in `setup-forseti-e2ee`.

---

## Copy rules

Tide failures have specific causes and specific fixes. Generic copy wastes them.

| Situation | Bad | Good |
|---|---|---|
| Role not yet propagated | "Access denied" | "Your access is still being applied — sign in again, or wait up to 2 minutes" |
| Offline, encryption attempted | "Encryption failed" | "Encryption needs a connection to the Tide network" |
| Popup blocked | *(nothing)* | "Your browser blocked the approval window. Allow popups and try again" |
| Session expired | silent redirect | "Your session ended. Sign in to continue" — preserve their input |
| Policy unsigned | "Something went wrong" | "Sharing isn't set up yet. An administrator needs to approve the sharing policy" |

Never surface raw SDK errors to end users. Never blame the user for a propagation delay or a configuration gap.

---

## Verification

- [ ] `isInitializing` renders a skeleton, not the sign-in screen
- [ ] `initError` renders an error, not a login button
- [ ] `isRefreshing` does not unmount content
- [ ] `sessionExpired` explains and offers re-sign-in without discarding input
- [ ] Tide actions are disabled when `isOffline`
- [ ] If callbacks are needed, the provider is `TideCloakContextProvider` (NOT `TideCloakProvider`, which drops them) and `onActionNotification` is wired to a toast/snackbar
- [ ] Enclave popups open from a direct click, with blocked-popup copy
- [ ] Missing-role errors mention propagation and offer re-login
- [ ] Encrypt/decrypt show per-item progress, not a page-wide block
- [ ] Shared-encryption UI is gated until the policy is signed

---

## Anti-patterns

- **AP-UX01 — Treating `!authenticated` as logged out.** Ignores `isInitializing`, so the sign-in screen flashes on every load for signed-in users.
- **AP-UX02 — Blanking the page on `isRefreshing`.** Background refreshes are routine; unmounting content makes the app flicker.
- **AP-UX03 — Generic "access denied" for propagation delay.** Tells the user they lack permission they were just granted. Name the delay, offer re-login.
- **AP-UX04 — Opening the approval popup after an `await`.** Loses the user-gesture context and gets blocked. Open it in the click handler.
- **AP-UX05 — Pretending encryption works offline.** Caching plaintext or faking offline decrypt breaks I-11 and the security model.
- **AP-UX06 — Exposing shared-encryption UI before the policy is signed.** Produces a runtime failure that reads as a bug.
- **AP-UX07 — Surfacing raw SDK errors.** "User has not been given any access to 'drop'" is a diagnostic, not user copy.
