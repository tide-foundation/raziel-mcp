"use client";

import { useTideCloak } from "@tidecloak/nextjs";

export default function HomePage() {
  const { authenticated, getValueFromIdToken, login, logout, isInitializing } =
    useTideCloak();

  if (isInitializing) {
    return <p>Loading...</p>;
  }

  if (!authenticated) {
    return (
      <div style={{ maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
        <h1>Tide E2EE Vault</h1>
        <p style={{ color: "#999", marginBottom: "2rem" }}>
          End-to-end encrypted secrets. Only you can decrypt your data.
        </p>
        <button onClick={login} style={btnStyle}>
          Login with Tide
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
      <h1>Tide E2EE Vault</h1>
      <p>Welcome, {getValueFromIdToken("preferred_username")}</p>
      <nav style={{ display: "flex", gap: "1rem", justifyContent: "center", marginTop: "1rem" }}>
        <a href="/vault" style={btnStyle}>
          Open Vault
        </a>
        <button onClick={logout} style={{ ...btnStyle, background: "#333" }}>
          Logout
        </button>
      </nav>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "0.75rem 1.5rem",
  fontSize: "1rem",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
};
