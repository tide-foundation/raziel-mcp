// Tide auth initialization using IAMService.
//
// IAMService is the shipped singleton and supports DPoP. DPoP is OPT-IN on the client: without
// `useDPoP` in the config the SDK issues plain bearer tokens and says nothing, and a realm that
// requires bound tokens (the pack's template does) then fails login with "DPoP proof is missing".
// There is no enableDpop flag. See canon/framework-matrix.md.

import { IAMService } from "@tidecloak/js";

// IAMService is a pre-instantiated singleton — use it directly.
// Do NOT call IAMService.getInstance() — it does not exist. (AP-51)
const iam = IAMService;

// Initialize from adapter JSON — pass the FULL config object, not {url, realm, clientId}. (AP-52)
const configRes = await fetch("/tidecloak.json");
const config = await configRes.json();
await iam.initIAM({ ...config, useDPoP: { mode: "strict", alg: "ES256" } });

// UI bindings
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const formSection = document.getElementById("form-section");

function updateUI() {
  const authenticated = iam.isAuthenticated();
  loginBtn.style.display = authenticated ? "none" : "inline";
  logoutBtn.style.display = authenticated ? "inline" : "none";
  formSection.style.display = authenticated ? "block" : "none";

  if (authenticated) {
    // IAMService has no getUserInfo(); read identity from the ID token's claims.
    const username = iam.getValueFromIdToken("preferred_username");
    userInfo.textContent = `Logged in as: ${username || "unknown"}`;
  } else {
    userInfo.textContent = "";
  }
}

loginBtn.addEventListener("click", () => {
  iam.doLogin();   // the redirect URI comes from the config; doLogin takes an optional return path
});

logoutBtn.addEventListener("click", () => {
  iam.doLogout();  // takes no arguments
});

// Listen to auth events
iam.on("authRefreshSuccess", updateUI);
iam.on("authRefreshError", () => {
  iam.doLogin();   // the redirect URI comes from the config; doLogin takes an optional return path
});

// Initial state
updateUI();

// Export for use by form.js
window.__tideIAM = iam;
