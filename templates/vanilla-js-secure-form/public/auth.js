// Tide auth initialization using IAMService.
//
// IAMService is the shipped singleton and supports DPoP. DPoP is enabled and
// enforced by default; configure it via useDPoP: { mode: 'strict', alg: 'ES256' }
// in the IAMService config. There is no enableDpop flag. See canon/framework-matrix.md.

import { IAMService } from "@tidecloak/js";

// IAMService is a pre-instantiated singleton — use it directly.
// Do NOT call IAMService.getInstance() — it does not exist. (AP-51)
const iam = IAMService;

// Initialize from adapter JSON — pass the FULL config object, not {url, realm, clientId}. (AP-52)
const configRes = await fetch("/tidecloak.json");
const config = await configRes.json();
await iam.initIAM(config);

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
    const user = iam.getUserInfo();
    userInfo.textContent = `Logged in as: ${user?.preferred_username || "unknown"}`;
  } else {
    userInfo.textContent = "";
  }
}

loginBtn.addEventListener("click", () => {
  iam.doLogin({ redirectUri: window.location.origin + "/auth/redirect" });
});

logoutBtn.addEventListener("click", () => {
  iam.doLogout({ redirectUri: window.location.origin + "/" });
});

// Listen to auth events
iam.on("authRefreshSuccess", updateUI);
iam.on("authRefreshError", () => {
  iam.doLogin({ redirectUri: window.location.origin + "/auth/redirect" });
});

// Initial state
updateUI();

// Export for use by form.js
window.__tideIAM = iam;
