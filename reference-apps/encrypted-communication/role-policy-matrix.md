# Encrypted Communication — Role & Policy Matrix

---

## Tide Bootstrap Roles

| Role | Type | Purpose | Created by | Approved by | Required before first use | Default / optional | Notes |
|------|------|---------|-----------|-------------|--------------------------|-------------------|-------|
| `_tide_enabled` | Realm | Enables Tide voucher system | Realm template | Auto (in default composite) | Yes | Default | Must be in `default-roles-{realm}` composite |
| `_tide_<tag>.selfencrypt` | Realm | Allows user to encrypt their private key with Tide | Realm template | IGA quorum (if added after import) | Yes | Default | Replace `<tag>` with app-specific name (e.g., `keys`, `chat`) |
| `_tide_<tag>.selfdecrypt` | Realm | Allows user to decrypt their private key with Tide | Realm template | IGA quorum (if added after import) | Yes | Default | Must pair with selfencrypt for round-trip |

---

## Application Roles (optional, app-defined)

This scenario does not require app-specific roles beyond the Tide bootstrap roles. The app may add its own roles for business logic (e.g., `admin`, `moderator`, `premium-user`), but these are separate from the encryption mechanism.

| Example role | Type | Purpose | Notes |
|-------------|------|---------|-------|
| `admin` | Realm | App admin (not Tide admin) | Optional. For app-level moderation, not IGA governance. |

---

## Key rules

1. **Self-encryption is identity-bound.** Only the user who called `doEncrypt` can call `doDecrypt` on the same ciphertext. This is the correct behavior for private key storage — no other user should be able to decrypt your private key.

2. **Both selfencrypt AND selfdecrypt roles are needed.** A user without `selfdecrypt` can store their encrypted key but cannot retrieve it on next login.

3. **Roles must be in the default composite.** New users get these roles automatically. If roles are missing from the composite, users must be assigned individually and the assignment must go through IGA.

4. **One tag is sufficient for this scenario.** Unlike the password manager scenario, this pattern does not need multiple tags or policy-governed encryption. A single tag (e.g., `keys`) covers the private key protection use case.

5. **No Forseti contracts needed.** Self-encryption does not require policy bytes, contracts, or VVK shared encryption. The Tide SDK handles it directly via `doEncrypt(data, tag)` / `doDecrypt(data, tag)`.

6. **No policy-governed encryption roles needed** (self-encryption variant only). The runtime E2E encryption uses an external crypto library, not Tide's policy-governed path.

---

## Shared Encryption Variant

If the app requires **Tide-native shared encryption** (recipients decrypt via `IAMService.doDecrypt` with policy bytes, not external crypto), the self-encryption path above is insufficient. You need:

1. **Additional roles**: A Forseti contract role (e.g., `shared-data-access`) that the contract checks for authorization
2. **Voucher gate roles**: `_tide_<tag>.selfencrypt` / `_tide_<tag>.selfdecrypt` still needed for the voucher system
3. **Forseti contract**: Deployed via `PolicySignRequest.addForsetiContractToUpload()` during the admin signing ceremony
4. **Playbook**: Add `setup-forseti-e2ee` to the playbook sequence BEFORE `add-rbac-nextjs`

See `setup-forseti-e2ee` playbook for the complete Forseti policy signing flow. VERIFIED (LEARNINGS-batch-009 L-03, L-06).

---

## What Tide does NOT handle in this scenario

| Concern | Handled by | Notes |
|---------|-----------|-------|
| Runtime message encryption | External crypto library (e.g., libsodium `crypto_secretbox`) | Tide has no involvement |
| Media frame encryption | External crypto library (e.g., libsodium with WebRTC Insertable Streams) | Tide has no involvement |
| Key exchange between users | External crypto library (e.g., libsodium `crypto_scalarmult`) | Uses public keys stored in DB |
| Conversation key generation | External crypto library | App generates symmetric keys for group chats |
| Key rotation / forward secrecy | App logic | Re-encrypt conversation key for remaining members when membership changes |
| Public key distribution | App server (stores public keys in database) | Server sees public keys, never private keys |

---

## Database Schema (minimum required)

The app must store encrypted key material. Minimum columns:

| Column | Type | Purpose |
|--------|------|---------|
| `user_id` | string | TideCloak user ID (from JWT `sub` claim) |
| `public_key` | text | User's public key (plaintext, for key exchange) |
| `encrypted_private_key` | text | User's private key encrypted by Tide self-encryption |
| `created_at` | timestamp | When keys were generated |

The encrypted_private_key column stores the base64 output of `doEncrypt()`. Size depends on the key type. For Ed25519 (32-byte private key): approximately 400 characters base64 after Tide encryption overhead.

Optional extensions: key version, key history table (for forward secrecy), per-room conversation keys.
