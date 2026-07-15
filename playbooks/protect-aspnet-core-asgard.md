# Protect an ASP.NET Core API with TideCloak (via Tide.Asgard.AspNetCore)

Wire TideCloak authentication into an ASP.NET Core resource server using the **Tide.Asgard.AspNetCore** SDK. Validates Tidecloak-issued EdDSA JWTs locally and performs RFC 8693 OAuth Token Exchange when your API needs to call another protected service.

This playbook supersedes the stock `Microsoft.AspNetCore.Authentication.OpenIdConnect` approach floated in PUC-092 / PUC-093. The asgard SDK ships Tide-specific helpers (`Utils.GetEd25519IssuerKey`, `AddTokenExchange`, EdDSA `SignatureProvider`) that remove most of the manual JWKS wiring the OIDC path required.

---

> ## Current Status (temporary — 2026-05-14)
>
> The asgard .NET SDK only works against TideCloak realms where **IGA is OFF**. This is a hard constraint at present, not a recommendation.
>
> Implications:
> - Use the **staging** TideCloak Docker image: `tideorg/tidecloak-stg-dev`. The non-staging dev image does not give you the auth flow the asgard SDK targets.
> - Run the realm in **BYOiD-only mode** (license applied, IGA not toggled on). This is documented as a valid deployment mode in [canon/concepts.md](../canon/concepts.md) — "BYOiD-only (license + no IGA)".
> - **No `tide-realm-admin` role assignment is needed** for the admin user. That role is part of the IGA quorum machinery and only relevant when IGA is on. With IGA off, normal Keycloak admin permissions are sufficient.
> - **No `toggle-iga` call** during realm setup. Stop the canonical bootstrap order (license → IGA → E2EE) at the licence step.
> - E2EE is not available in this mode (E2EE requires IGA). Asgard .NET today is auth + token-exchange only, so this matches the SDK's surface.
>
> When the SDK adds IGA support, this section will be removed and the prerequisites updated. Tracking note: [notes/asgard-dotnet-current-status.md](../notes/asgard-dotnet-current-status.md).

---

## When to Use

- You have an ASP.NET Core (.NET 10) API that needs to validate JWTs issued by Tidecloak.
- Your front end is a Tide-aware SPA (uses `@tidecloak/js`) and your backend is C#.
- You need server-to-server token exchange (RFC 8693) — e.g. your API calls a downstream protected service on behalf of the user.

## When NOT to Use

- Your stack is Next.js / React / Vanilla JS — use [protect-api-nextjs.md](protect-api-nextjs.md) / [verify-jwt-server-side.md](verify-jwt-server-side.md) instead.
- You need browser-side **DPoP**: the asgard `.WithDPoP(...)` registration is commented out at HEAD (see [Common Failures](#common-failures)).
- You need to **build, sign, or test Tide Policies / contracts** server-side from .NET. The asgard .NET SDK does not include the TS `asgard-tide` wire-format library; policy signing today lives in the JS stack (`heimdall-tide` + `@tidecloak/js`).

## Status classifications

- `Tide.Asgard.AspNetCore.Authentication` v0.1.0 — **VERIFIED** against `sources/asgard-sdk/aspnet/Tide.Asgard.AspNetCore/Tide.Asgard.AspNetCore/`.
- `Tide.Asgard.Core` v0.1.0 — **VERIFIED**. Provides EdDSA `SignatureProvider` over `Microsoft.IdentityModel.Tokens 8.15.0` and `BouncyCastle.Cryptography 2.6.2`.
- `Tide.Asgard.AspNetCore.DPoP` — **OBSERVED_PATTERN**. Built and ProjectReferenced by the Example, but no `<PackageId>` is set and the registration helper `.WithDPoP(...)` is commented out. Validation primitives exist; usage requires manual service registration.

---

## Prerequisites

- **.NET 10 SDK** (preview-tier). Every csproj pins `<TargetFramework>net10.0</TargetFramework>`.
- TideCloak running using the **staging** Docker image (`tideorg/tidecloak-stg-dev`) — see Current Status above and [deploy-tidecloak-docker.md](deploy-tidecloak-docker.md).
- A realm licensed via `setUpTideRealm`, with **IGA NOT toggled on** (BYOiD-only mode). Do NOT run `toggle-iga` for an asgard-.NET-backed app today.
- An admin user able to manage the realm. **No `tide-realm-admin` role assignment is required** — that role is IGA-specific and not in play here. A standard Keycloak realm admin is sufficient.
- The asgard repo is already vendored under `sources/asgard-sdk/` in this pack — the .NET SDK is **consumed via `<ProjectReference>`**, not NuGet. INFERRED: NuGet publication is not yet verified for `0.1.0`.
- Your ASP.NET Core project ready to authenticate.

---

## Files to Inspect

- `sources/asgard-sdk/aspnet/Tide.Asgard.AspNetCore/Tide.Asgard.AspNetCore.Example/Program.cs` — canonical wiring (note: README form and Example form **differ**, see Step 3).
- `sources/asgard-sdk/aspnet/Tide.Asgard.AspNetCore/Tide.Asgard.AspNetCore/Utils.cs` — `GetEd25519IssuerKey` extension.
- `sources/asgard-sdk/aspnet/Tide.Asgard.AspNetCore/Tide.Asgard.AspNetCore/ServiceCollectionExtensions.cs` — `AddTokenExchange` overloads.
- `sources/asgard-sdk/aspnet/Tide.Asgard.AspNetCore/Tide.Asgard.AspNetCore/TokenExchange/TokenExchangeService.cs` — exchange implementation; only the **Bearer** path works.
- `sources/asgard-sdk/README.md` — official .NET wiring guide (the README is exclusively about the .NET SDK; the TypeScript `asgard-tide` package is not documented there).

## Files to Edit

- `*.csproj` — add `<ProjectReference>` to the asgard projects.
- `Program.cs` — register authentication and (optionally) token exchange.
- `appsettings.json` — paste the **backend** client's adapter config under a `Keycloak` key.
- Controllers — add `[Authorize]`; inject `ITokenExchangeService` only where needed.

---

## Step 1: Configure two Tidecloak clients

In your realm, create one **public** client for the browser SPA and one **confidential** client for the .NET backend. The audience mapper is mandatory — without it the backend rejects browser-issued tokens with 401.

| Client | Type | Settings | Why |
|---|---|---|---|
| `browser-login-page` | Public | Set valid redirect URIs and web origins matching your SPA host (e.g. `http://localhost:3000`). | SPA login. |
| `backend` | Confidential | **Client authentication** ON. **Standard Token Exchange** ON (only if Step 5 needed). | Backend JWT validation + token exchange. |

Then add an **Audience mapper** to the browser client:

- In your realm -> Clients -> `browser-login-page` -> Client scopes -> `browser-login-page-dedicated` -> Add mapper -> By configuration -> Audience.
- Name: `backend-mapper`. Included Client Audience: `backend`. Save.

> If your realm uses Tide for user authentication, create your licence **before** creating any clients. VERIFIED (`sources/asgard-sdk/README.md` line 35).

> **Do NOT toggle IGA on** for this realm. The asgard .NET SDK does not work against IGA-enabled realms today — see Current Status above. Stop the canonical bootstrap order at the licence step; skip `toggle-iga`.

## Step 2: Add the asgard projects to your .NET solution

Until NuGet publication is verified, vendor the asgard repo into your workspace and reference the projects directly:

```xml
<!-- Your.Api.csproj -->
<ItemGroup>
  <ProjectReference Include="..\asgard\aspnet\Tide.Asgard.AspNetCore\Tide.Asgard.AspNetCore\Tide.Asgard.AspNetCore.Authentication.csproj" />
  <!-- Optional, only if you plan to register DPoP services manually -->
  <ProjectReference Include="..\asgard\aspnet\Tide.Asgard.AspNetCore\Tide.Asgard.AspNetCore.DPoP\Tide.Asgard.AspNetCore.DPoP.csproj" />
</ItemGroup>
```

Transitive package dependencies that get pulled in:

| Package | Version | Source |
|---|---|---|
| `Keycloak.AuthServices.Authentication` | 2.9.0 | Authentication.csproj |
| `Keycloak.AuthServices.Authorization` | 2.9.0 | Authentication.csproj |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | 10.0.7 | Authentication.csproj |
| `BouncyCastle.Cryptography` | 2.6.2 | Core.csproj |
| `Microsoft.IdentityModel.Tokens` | 8.15.0 | Core.csproj |

## Step 3: Paste the backend adapter config into `appsettings.json`

Download the **backend** client's adapter config: realm -> Clients -> `backend` -> top-right **Action** -> **Download adapter config**. Paste under a `Keycloak` key. The section name is fixed — `Keycloak.AuthServices` reads it by default and `AddTokenExchange(IConfiguration)` hardcodes the same name (`ServiceCollectionExtensions.cs` line 117).

```json
{
  "Logging": { "LogLevel": { "Default": "Information", "Keycloak.AuthServices": "Debug" } },
  "AllowedHosts": "*",
  "Keycloak": {
    "realm": "<your-realm>",
    "auth-server-url": "https://<your-tidecloak-host>",
    "ssl-required": "external",
    "resource": "backend",
    "credentials": { "secret": "<from-credentials-tab>" },
    "confidential-port": 0,
    "jwk": {
      "keys": [
        {
          "kid": "<from-realm-keys>",
          "kty": "OKP",
          "alg": "EdDSA",
          "use": "sig",
          "crv": "Ed25519",
          "x": "<base64url-public-key>"
        }
      ]
    },
    "homeOrkUrl": "https://<your-home-ork>"
  }
}
```

> Do not commit real client secrets. The asgard example commits a demo secret in two places (`appsettings.json` and `README.md`), which the NuGet README inherits because `Authentication.csproj` packs the root README. **Use user secrets (`dotnet user-secrets`) or environment variables in real apps.** VERIFIED footgun.

## Step 4: Register authentication in `Program.cs`

Use the **README form**, not the Example form. The Example `Program.cs` has the `IssuerSigningKey` line commented out (`sources/asgard-sdk/.../Example/Program.cs:17`); copying it gives you a runtime that cannot validate Tidecloak's EdDSA tokens.

```csharp
using Keycloak.AuthServices.Authentication;
using Tide.Asgard.AspNetCore.Authentication;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();

builder.Services
    .AddKeycloakWebApiAuthentication(builder.Configuration, options =>
    {
        options.RequireHttpsMetadata = false; // set true in production
        options.TokenValidationParameters.IssuerSigningKey =
            Utils.GetEd25519IssuerKey(builder.Configuration);
    });

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.Run();
```

What this does:

- `AddKeycloakWebApiAuthentication` wires JWT Bearer validation against the `Keycloak` section.
- `Utils.GetEd25519IssuerKey` walks `Keycloak:jwk:keys[]` for `crv=Ed25519` and returns a `SecurityKey` backed by the EdDSA `SignatureProvider` in `Tide.Asgard.Core`. Tidecloak signs tokens with EdDSA — the stock Microsoft stack does not ship EdDSA, so this step is required.
- `GetEd25519IssuerKey` is an extension method on both `IConfiguration` (`Utils.cs:18`) and `IConfigurationSection` (`Utils.cs:25`). Either form works; the static call shown above is the most common.

## Step 5: (Optional) Wire Token Exchange

Only needed if your API calls another protected service on behalf of the caller. Register the service:

```csharp
builder.Services.AddTokenExchange(builder.Configuration); // reads the "Keycloak" section
```

To register multiple exchange clients in one app (e.g. one per downstream audience), use the `IConfigurationSection` overload and point each registration at a different section.

Inject `ITokenExchangeService` into a controller and call `ExchangeToken`:

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Tide.Asgard.AspNetCore.Authentication.TokenExchange;

[Authorize]
[ApiController]
[Route("[controller]")]
public class HelloController(ITokenExchangeService exchange) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var token = await exchange.ExchangeToken(
            HttpContext.Request.Headers,
            requestingClientId: "backend",
            requestedAudience: "downstream-service"); // must exist as a realm client
        return Ok(token);
    }
}
```

Behavioral notes:

- The exchange posts `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` to `protocol/openid-connect/token` and returns the new `access_token` (`TokenExchangeService.cs:42-85`).
- The HTTP client is registered as a **singleton with the backend client secret baked into the Basic-auth header** (`ServiceCollectionExtensions.cs:91-97`). Rotating the secret requires an app restart.
- `requestedAudience` must be a realm client. The asgard Example uses Keycloak's built-in `"account"` client as a demo; replace with a real audience.

## Step 6: Protect endpoints

Standard ASP.NET Core authorization. Nothing Tide-specific.

```csharp
[Authorize]
[ApiController]
[Route("[controller]")]
public class SecretController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok($"Hello, {User.Identity?.Name}");
}
```

For role-based authorization, use `Keycloak.AuthServices.Authorization` policies — the `Authorization` package is referenced transitively.

## Step 7: SPA side (if you control it)

Your SPA uses `@tidecloak/js` with the **public** client's adapter config. Reference pattern (`sources/asgard-sdk/.../Example/ClientApp/src/main.js`):

```js
import { TideCloak } from "@tidecloak/js";
const kc = new TideCloak("keycloak.json");
await kc.init({ onLoad: "login-required", checkLoginIframe: false });
await kc.secureFetch(`${origin}/Secret`, {
  headers: { Authorization: `Bearer ${kc.token}` },
});
```

The audience mapper from Step 1 is what lets the .NET backend accept tokens issued for `browser-login-page`. If `aud` does not include `backend` you will see 401.

**Do not enable `useDPoP`** in `kc.init({...})` at this point. The .NET token-exchange path crashes on DPoP-tagged requests — see [Common Failures](#common-failures).

---

## Verification

- [ ] `Tide.Asgard.AspNetCore.Authentication.csproj` is referenced from your csproj.
- [ ] `appsettings.json` has a `Keycloak` section with `realm`, `auth-server-url`, `resource`, `credentials.secret`, and `jwk.keys[]` containing an Ed25519 key.
- [ ] `Program.cs` calls `AddKeycloakWebApiAuthentication` **with** `options.TokenValidationParameters.IssuerSigningKey = Utils.GetEd25519IssuerKey(...)`.
- [ ] An unauthenticated request to a `[Authorize]` endpoint returns 401.
- [ ] A request with a valid `Authorization: Bearer <token>` from `browser-login-page` (containing `backend` in `aud`) succeeds.
- [ ] If Step 5 is wired: `ITokenExchangeService.ExchangeToken(...)` returns a non-empty access token for the configured audience.
- [ ] Logs show `Keycloak.AuthServices` at Debug level emitting validation traces.

---

## Common Failures

| Symptom | Cause | Repair |
|---|---|---|
| 401 with `IDX10503: Signature validation failed. Token does not have a kid` or `Unable to match keys` | Step 4's `IssuerSigningKey = Utils.GetEd25519IssuerKey(...)` line missing or commented (matches the Example, not the README) | Add the line back. See `sources/asgard-sdk/README.md:129`. |
| 401 with `Audience validation failed` on browser-issued tokens | Audience mapper missing from `browser-login-page` | Step 1 — add `backend-mapper` to the `browser-login-page-dedicated` client scope. |
| `NotImplementedException` thrown from `ExchangeToken` | The SPA enabled DPoP. `TokenExchangeService.cs:28-35` routes DPoP-tagged requests to `ExchangeDPoPToken`, which is a stub at line 93 | Disable `useDPoP` on the SPA (`kc.init`) until the SDK ships a DPoP-aware exchange path. |
| `NotImplementedException` thrown from a "Doken" auth header | `ExchangeTideDoken` is a stub at `TokenExchangeService.cs:132` | Do not use the Doken auth scheme with this SDK today. |
| Backend ignores DPoP proof on inbound requests | `.WithDPoP(...)` is commented out at `KeycloakWebApiAuthenticationBuilderExtensions.cs:33-68`; `DPoPProofValidationService` exists but is never registered | If you need DPoP today, register `DPoPProofValidationService` and the `MessageReceivedHandler` / `TokenValidationHandler` / `ChallengeHandler` event handlers manually. Or wait for the SDK to ship `.WithDPoP`. |
| 404 on `/` when running the asgard Example cold | The SPA at `ClientApp/` is **not built by MSBuild**. Vite outputs to `wwwroot/` but `Example.csproj` has no `<Target>` running `npm run build` | Run `npm install && npm run build` in `ClientApp/` before `dotnet run`. |
| `@tidecloak/js` cannot be resolved when running the asgard Example | `ClientApp/package.json` references `@tidecloak/js` from filesystem path `~/tidecloak-js/packages/tidecloak-js`, not npm | Clone `github.com/tide-foundation/tidecloak-js` to `~/tidecloak-js/` or update the reference to an npm version. |
| `BadImageFormat`, target framework mismatch | Project targets a pre-net10.0 framework | Bump `<TargetFramework>net10.0</TargetFramework>` and install the .NET 10 SDK. |
| Realm secret rotated but exchanges still use the old secret | The exchange `HttpClient` is a singleton with Basic-auth baked in at registration time (`ServiceCollectionExtensions.cs:91-97`) | Restart the app after rotation. ASSUMED: there is no hot-reload path. |

---

## Anti-patterns and Do Not Do This

- **Do not copy the Example `Program.cs` verbatim.** The Example has `IssuerSigningKey` commented out — JWT validation will silently fail on EdDSA tokens. Use the README form.
- **Do not commit `credentials.secret`** to source control. The asgard example does this twice for demo purposes (`appsettings.json:20`, `README.md:91`). Use `dotnet user-secrets` for development and environment variables / a secrets manager for production.
- **Do not enable browser DPoP today.** `useDPoP` in the SPA causes every Token Exchange call to throw `NotImplementedException` (see Common Failures).
- **Do not point `requestedAudience` at the wrong client.** It must exist as a realm client with Standard Token Exchange enabled. `"account"` works in demos because it is Keycloak's built-in client.
- **Do not register `AddTokenExchange(IConfiguration)` for multi-client scenarios.** Use the `IConfigurationSection` overload — the `IConfiguration` form hardcodes the `"Keycloak"` section name (`ServiceCollectionExtensions.cs:117`).
- **Do not rely on the commented-out helpers.** `UseTidecloakDashboard`, `UseTideSecuredDPoP`, `AddAutoClientCeritificationToDashboard`, `.WithDPoP` — all four are commented out at HEAD. The public type signatures (`TidecloakDashboardOptions`, `MTLSOptions`, `ClientCertificationOptions`) ship but nothing wires them.
- **Do not assume the .NET SDK validates Tide Policies / Forseti contracts.** Policy enforcement happens on ORKs (C# Forseti contracts, see [custom-contracts.md](../canon/custom-contracts.md)). The .NET SDK only handles JWT auth and token exchange.
- **Do not treat folder names as canonical.** The source tree contains typos that are reachable via `using` statements: `ClientCeritifcation/` (should be `ClientCertification`), `MessageRecievedHandler.cs` (should be `Received`). Grep for the wrong spelling or you will miss them.

---

## Repair Path

If you have an existing ASP.NET Core API on TideCloak that is misbehaving:

1. **JWT validation failures** — confirm `IssuerSigningKey = Utils.GetEd25519IssuerKey(...)` is present in `Program.cs`. The Microsoft default JWT handler does not ship EdDSA.
2. **401 with audience mismatch** — confirm the SPA's client has an audience mapper to the backend client.
3. **Token exchange throws** — confirm no DPoP / Doken auth header is being sent. Today only Bearer works.
4. **Inbound DPoP** — confirm whether you actually need it. If yes, you are off the supported path and must register DPoP services manually (see Common Failures row). If no, ignore the `Tide.Asgard.AspNetCore.DPoP` project entirely.

---

## Cross-references

- [add-auth-nextjs-fresh.md](add-auth-nextjs-fresh.md) — Next.js equivalent (different SDK).
- [protect-api-nextjs.md](protect-api-nextjs.md) / [verify-jwt-server-side.md](verify-jwt-server-side.md) — Node-side JWT verification path.
- [Step 5: Wire Token Exchange](#step-5-optional-wire-token-exchange) — RFC 8693 token exchange is the shipped path for .NET server-to-server delegation. (Browser-driven server-side delegation is an asgard feature — the `asgard-tide` Node SDK, the same one keylessh's server-delegation uses — and is unmerged/experimental, not on main, so there is no standalone server-delegation playbook.)
- [custom-contracts.md](../canon/custom-contracts.md) — Forseti contracts; out of scope for this playbook but relevant if your .NET API is downstream of policy-governed signing.
- [framework-matrix.md](../canon/framework-matrix.md#net--aspnet-core-via-asgard) — concise framework entry for .NET via asgard.
