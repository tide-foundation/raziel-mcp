# Encrypted Real-Time Communication

## What this is

A real-time communication app (chat, video calls, or both) where all user content is end-to-end encrypted. TideCloak handles authentication and protects long-lived private key material at rest via self-encryption. A separate client-side crypto library handles runtime E2E operations (message encryption, media frame encryption, key exchange). The server stores only ciphertext and never sees plaintext content or private keys.

This is a **hybrid encryption** pattern:
- **Layer 1 (Tide)**: Self-encryption protects the user's private key stored in the database.
- **Layer 2 (external crypto)**: A client-side library (e.g., libsodium, WebCrypto) uses the decrypted private key for runtime E2E operations.

---

## Built-in contract: share a room's key with its members

Messages are encrypted outside Tide. What Tide protects is the **key store**. Today each member
self-encrypts their copy of a room key. With the ORK's built-in `RelationshipAttestation:1`
(`relationship-attestation`) a room key can instead be encrypted **once** under a policy whose
subject is the room's member group:

| Policy param | Value |
|---|---|
| `subjectType` / `subjectId` | `Group` / the room's group, exactly as in the `groups` claim (claim name mandated) |
| `assignmentId` | the room id — also the only tag on the encrypted key |
| `roles` | `["_tide_encryptor","_tide_decryptor"]` for members who may rotate the key, `["_tide_decryptor"]` for read-only members |

Removing a member from the group stops them decrypting the **stored** key once their credential
refreshes; rotate the room key as well, since they may hold the old one. This is an INFERRED design:
it has not been built or run. The contract itself is on ORK `main` (VERIFIED from source
`c69fc4f6`, 2026-10-16).

## When to use this scenario

Use when the app needs:
- Real-time encrypted messaging (1:1 or group)
- Encrypted voice/video calls
- Zero-knowledge server (server stores ciphertext only)
- Per-user asymmetric key pairs with Tide-protected private key storage
- Forward secrecy via key rotation when group membership changes
- Runtime encryption that Tide's built-in `doEncrypt`/`doDecrypt` does not cover (e.g., streaming media frame encryption, libsodium `crypto_secretbox`, WebCrypto `AES-GCM`)

Do NOT use when:
- Data is encrypted at rest and does not need real-time streaming decryption — use `organisation-password-manager` instead
- Only the encrypting user needs to decrypt — use standard self-encryption via `tide-rbac-and-e2ee`
- The app needs cryptographic signing, not encryption — use `policy-governed-signing`
- The app only needs authentication with no encryption — use standard auth playbooks

---

## Core Tide capabilities used

| Capability | Role in this scenario |
|-----------|----------------------|
| TideCloak SSO (OIDC) | Core: user authentication, JWT-based identity |
| Self-encryption (`doEncrypt`/`doDecrypt`) | Core: encrypt/decrypt user's private key for storage |
| `_tide_<tag>.selfencrypt` / `_tide_<tag>.selfdecrypt` roles | Core: gate access to self-encryption operations |
| `_tide_enabled` role | Core: required for all Tide operations |
| Server-side JWT verification | Required: protect API endpoints that store/serve encrypted key material |
| DPoP (optional but recommended) | Recommended: bind tokens to client for API protection |
| IGA | Required: approve role assignments before E2E works |

**Not used in the default self-encryption path**: Policy-governed encryption, Forseti contracts, VVK shared encryption, doken-based signing.

**Shared encryption variant**: If the app needs Tide-native shared encryption (recipients decrypt ciphertext via `IAMService.doDecrypt` with policy bytes), use the built-in `RelationshipAttestation:1` contract as described in "Built-in contract" above: one admin-approved policy per room, nothing deployed. Do not write a custom contract for this. See `role-policy-matrix.md`.

---

## What must exist before first user access

1. TideCloak running with a licensed, IGA-enabled realm
2. Realm roles: `_tide_enabled`, `_tide_<tag>.selfencrypt`, `_tide_<tag>.selfdecrypt` in the default composite
3. At least one admin user with `tide-realm-admin` linked and initial change requests committed
4. Adapter JSON exported with `jwk` field
5. App deployed with TideCloak provider and server-side JWT verification
6. Database table for storing encrypted key material (public key + Tide-encrypted private key per user)

---

## Bootstrap-only steps (admin)

1. Start TideCloak container
2. Create realm from template with self-encryption roles
3. License realm (`setUpTideRealm`)
4. Enable IGA (`toggle-iga`)
5. Create admin user, assign `tide-realm-admin`, generate invite link
6. Admin completes Tide account linking
7. Approve and commit initial change requests (client, user, role)
8. Sign IDP settings (`sign-idp-settings`)
9. Export adapter JSON to app

---

## Runtime user flow

On **first login** for a new user:
1. User authenticates via TideCloak SSO
2. App checks database for existing encrypted key material
3. No keys found → app generates a new asymmetric keypair client-side (e.g., `crypto_box_keypair()`)
4. App encrypts the private key using `doEncrypt([{ data: privateKeyBytes, tags: [tag] }])` (Tide self-encryption)
5. App stores the encrypted private key and the public key in the database via a protected API endpoint
6. Private key is now available in memory for runtime E2E operations

On **returning login**:
1. User authenticates via TideCloak SSO
2. App fetches encrypted key material from database
3. App decrypts the private key using `doDecrypt([{ encrypted: encryptedPrivateKey, tags: [tag] }])` (Tide self-encryption)
4. Private key is now available in memory for runtime E2E operations

**Runtime E2E operations** (not Tide — handled by external crypto library):
- Key exchange: use the decrypted private key + recipient's public key to derive shared secrets
- Message encryption: symmetric encryption (e.g., `crypto_secretbox`) with conversation keys
- Media frame encryption: per-frame symmetric encryption for WebRTC Insertable Streams
- Key rotation: generate new conversation key when group membership changes, re-encrypt for all members

---

## Default playbook sequence

1. `start-tidecloak-dev`
2. `bootstrap-realm-from-template`
3. `initialize-admin-and-link-account`
4. `configure-e2ee-roles-and-policies`
5. `add-auth-nextjs-fresh` (adapt for React/Vite if not Next.js)
6. `protect-routes-nextjs`
7. `protect-api-nextjs`
8. `verify-jwt-server-side`
9. `add-rbac-nextjs`

---

## Key diagnostics

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `doEncrypt` fails with "User has not been given any access to 'tag'" | Missing `_tide_<tag>.selfencrypt` role | Assign role, approve via IGA, re-login |
| `doDecrypt` fails with same error | Missing `_tide_<tag>.selfdecrypt` role | Assign role, approve via IGA, re-login |
| `doDecrypt` fails on stored ciphertext | User does not own this ciphertext (self-encryption is identity-bound) | Verify the same user encrypted it |
| Key material API returns 401 | JWT verification failing | Check token, DPoP proof, adapter `jwk` |
| Private key decrypts but E2E still fails | Runtime crypto library error, not Tide | Debug the external crypto separately |
| New user cannot decrypt old group messages | Expected: forward secrecy means pre-join messages are inaccessible | Store key history per version if historical access is needed |
| Login completes but encrypt/decrypt unavailable | Roles not in token yet (120s delay after IGA commit) | Re-login or wait for token refresh |

---

## Intentionally configurable

- **Crypto library**: libsodium, WebCrypto, tweetnacl, or any client-side crypto library. Tide does not constrain this choice.
- **Key type**: Ed25519/X25519 (libsodium), ECDH P-256 (WebCrypto), or any asymmetric scheme. The private key is just bytes to `doEncrypt`.
- **Encryption tag**: Any short alphanumeric string (e.g., `keys`, `self`, `chat`). Must match the `_tide_<tag>` roles in the realm.
- **Key storage schema**: The database schema for storing encrypted keys is app-defined. Minimum: user ID, public key, encrypted private key.
- **Key rotation strategy**: App-defined. Common: rotate conversation key on member join/leave for forward secrecy.
- **Transport**: WebSocket, WebRTC, HTTP polling, or any transport. Tide does not constrain this.
- **Message format**: App-defined. Tide only touches the private key storage, not the message wire format.
