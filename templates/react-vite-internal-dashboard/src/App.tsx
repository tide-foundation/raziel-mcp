import {
  useTideCloak,
  useAuthCallback,
  Authenticated,
  Unauthenticated,
} from "@tidecloak/react";

// IMPORTANT: isInitializing must be checked BEFORE Authenticated/Unauthenticated guards.
// Unauthenticated renders during init because the user is not yet authenticated.
function App() {
  const { isInitializing } = useTideCloak();

  // Handle OIDC callback: detect ?code= or ?error= in URL, process the token
  // exchange, then redirect to the original page or home.
  const { isCallback, isProcessing, error: callbackError } = useAuthCallback({
    onSuccess: (returnUrl) => {
      window.location.assign(returnUrl || "/");
    },
    onError: () => {
      window.location.assign("/");
    },
    onMissingVerifierRedirectTo: "/",
  });

  if (isCallback) {
    if (callbackError) return <p>Authentication failed: {callbackError.message}</p>;
    if (isProcessing) return <p>Completing login...</p>;
    return <p>Redirecting...</p>;
  }

  if (isInitializing) return <p>Initializing TideCloak...</p>;

  return (
    <>
      <Authenticated>
        <Dashboard />
      </Authenticated>
      <Unauthenticated>
        <LoginPage />
      </Unauthenticated>
    </>
  );
}

function LoginPage() {
  const { login } = useTideCloak();
  return (
    <div>
      <h1>Internal Dashboard</h1>
      <button onClick={login}>Login with Tide</button>
    </div>
  );
}

function Dashboard() {
  const { hasRealmRole, logout, token } = useTideCloak();

  // hasRealmRole() is UI gating only. It does NOT protect APIs.
  // Your backend must verify JWT server-side for any protected endpoint.
  const isAdmin = hasRealmRole("admin");

  async function fetchProtectedData() {
    // Replace this URL with your actual backend API.
    // The backend MUST verify the JWT server-side. This template has no backend.
    const res = await fetch("http://localhost:4000/api/data", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      alert(`API returned ${res.status}. Is your backend running?`);
      return;
    }
    const data = await res.json();
    console.log("Protected data:", data);
  }

  return (
    <div>
      <h1>Dashboard</h1>

      {isAdmin && (
        <section>
          <h2>Admin Section</h2>
          <p>
            Visible to admins (UI gating only). API enforces the real check.
          </p>
        </section>
      )}

      <button onClick={fetchProtectedData}>Fetch Protected Data</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

export default App;
