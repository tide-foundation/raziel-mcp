"use client";

import { useTideCloak } from "@tidecloak/nextjs";

// Public home page. No auth required.
export default function HomePage() {
  const { authenticated, getValueFromIdToken, login, logout, isInitializing } =
    useTideCloak();

  if (isInitializing) {
    return <p>Loading...</p>;
  }

  if (!authenticated) {
    return (
      <div>
        <h1>Customer Portal</h1>
        <p>Login to access your account.</p>
        <button onClick={login}>Login with Tide</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Welcome, {getValueFromIdToken("preferred_username")}</h1>
      <nav>
        <a href="/dashboard">Dashboard</a>
      </nav>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
