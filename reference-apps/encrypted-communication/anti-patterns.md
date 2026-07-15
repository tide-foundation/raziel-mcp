# Encrypted Communication — Anti-Patterns

Scenario-specific mistakes for encrypted communication apps using the hybrid Tide + external crypto pattern. General Tide anti-patterns (I-01 through I-16, AP-01 through AP-42) still apply.

---

## AP-EC01: Storing private keys in plaintext

**Mistake**: Storing the user's private key in the database without Tide encryption, or storing it in localStorage/sessionStorage.

**Why it fails**: The private key is the root of trust for all E2E operations. If stored in plaintext, a database breach or XSS attack exposes all encrypted communications.

**Fix**: Always encrypt the private key with `doEncrypt([{ data: privateKeyBytes, tags: [tag] }])` before storing. Always decrypt with `doDecrypt()` on login. Never persist the decrypted private key outside of in-memory variables.

---

## AP-EC02: Generating keys server-side

**Mistake**: Generating the user's asymmetric keypair on the server and sending the private key to the client.

**Why it fails**: The server sees the private key in plaintext, breaking the zero-knowledge property. The private key transits over the network unprotected by Tide.

**Fix**: Generate keypairs client-side only. The server never sees the private key. It only stores the Tide-encrypted ciphertext.

---

## AP-EC03: Using Tide doEncrypt/doDecrypt for runtime message encryption

**Mistake**: Encrypting every chat message or media frame with Tide's `doEncrypt()`.

**Why it fails**: Tide self-encryption is identity-bound (only the encrypting user can decrypt). Other participants cannot decrypt messages encrypted this way. Also, `doEncrypt()` requires a round-trip to the ORK network, making it too slow for real-time frame-by-frame media encryption.

**Fix**: Use Tide self-encryption only for private key storage (once per login). Use an external crypto library for runtime E2E operations (message encryption, frame encryption, key exchange).

---

## AP-EC04: Skipping key material API protection

**Mistake**: Serving the encrypted key material endpoint without JWT verification. Anyone can fetch any user's encrypted private key.

**Why it fails**: While the encrypted private key cannot be decrypted without Tide (identity-bound), exposing it unnecessarily increases attack surface. The public key endpoint may also leak presence information.

**Fix**: Protect key material API endpoints with server-side JWT verification. Only serve a user's own encrypted private key to that authenticated user. Public keys may be more broadly accessible but still require authentication.

---

## AP-EC05: Trusting client-supplied public keys without verification

**Mistake**: Accepting a user's public key from the client without verifying it corresponds to the encrypted private key.

**Why it fails**: An attacker could submit a different public key, enabling a key substitution attack. Other users would encrypt messages to the attacker's key instead of the real user's key.

**Fix**: Verify the public key matches the private key on the client side before storing. For libsodium Ed25519, derive the public key from the private key and compare. The server cannot verify this (it never sees the private key), so the client must do it.

---

## AP-EC06: No key rotation on membership change

**Mistake**: Using the same conversation key after a member leaves a group chat or call.

**Why it fails**: The departed member still has the conversation key and can decrypt future messages if they intercept the ciphertext.

**Fix**: Rotate the conversation key when any member leaves. Generate a new key and distribute it (encrypted) to remaining members only. Store key history with version numbers so old messages remain decryptable with the old key.

---

## AP-EC07: Encrypting conversation keys with Tide instead of public-key crypto

**Mistake**: Using `doEncrypt()` to encrypt conversation keys for distribution to other users.

**Why it fails**: Tide self-encryption is identity-bound. If user A encrypts the conversation key with `doEncrypt()`, only user A can decrypt it. User B cannot decrypt it.

**Fix**: Use the external crypto library's public-key encryption for key distribution. Encrypt the conversation key with each recipient's public key individually.

---

## AP-EC08: Treating ProtectedRoute as API protection

**Mistake**: Using a client-side `ProtectedRoute` component as the only access control for encrypted data.

**Why it fails**: Client-side route guards are UI gating only. The API endpoints serving key material and encrypted messages are still accessible via direct HTTP requests.

**Fix**: Every API endpoint that serves or accepts encrypted data must have server-side JWT verification. The `ProtectedRoute` component is a UX convenience, not a security boundary.

---

## AP-EC09: Hardcoding the encryption tag

**Mistake**: Using a hardcoded tag string (e.g., `"self"`) without ensuring matching roles exist in the realm.

**Why it fails**: `doEncrypt(data, "chat")` requires the user to have `_tide_chat.selfencrypt`. If the realm only has `_tide_self.selfencrypt`, the operation fails with "User has not been given any access to 'chat'".

**Fix**: Choose one tag name. Ensure the realm template includes matching `_tide_<tag>.selfencrypt` and `_tide_<tag>.selfdecrypt` roles. Document the tag name. Do not change it after users have encrypted data with it.

---

## AP-EC10: Initializing crypto before TideCloak auth completes

**Mistake**: Calling `doEncrypt()` or `doDecrypt()` before the TideCloak provider has finished initializing and the user is authenticated.

**Why it fails**: The SDK requires an active session with valid doken. Calling encryption methods before auth completes throws errors or returns undefined.

**Fix**: Wait for `isAuthenticated === true` before attempting any Tide encryption operations. Gate the key initialization flow on authentication completion.

---

## AP-EC11: Losing the decrypted private key on token refresh

**Mistake**: Clearing the in-memory private key state when the TideCloak token refreshes.

**Why it fails**: Token refresh is a normal background operation. Clearing crypto state forces the user to re-decrypt their private key, which may briefly break active E2E sessions.

**Fix**: Keep the decrypted private key in a React ref or module-level variable that survives re-renders and token refreshes. Only clear it on explicit logout.

---

## AP-EC12: Using `@tidecloak/react` version 0.99.x

**Mistake**: Installing a 0.99.x pre-release version of the Tide SDK.

**Why it fails**: 0.99.x versions are unstable pre-releases. The stable version is 0.13.33 (per pack version policy).

**Fix**: Pin `@tidecloak/react` to `0.13.33`. See `canon/version-policy.md`.
