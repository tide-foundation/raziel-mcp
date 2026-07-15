import { withAuth } from "@/lib/auth/protect";

// Playbook: protect-api-nextjs Step 3
// This is where REAL authorization happens.
// JWT is verified server-side against embedded JWKS.
// Route guards and hasRole() on the client do NOT protect this endpoint.
export const GET = withAuth(async (_req, jwt) => {
  // Stub data. Replace with your database query.
  return Response.json({
    customers: [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ],
    verifiedUser: jwt.sub,
  });
});
