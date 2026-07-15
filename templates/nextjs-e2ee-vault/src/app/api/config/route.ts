import { loadTideConfig } from "@/lib/auth/tidecloakConfig";

// Serve adapter JSON for server-side use (e.g. JWT verification).
// The client-side SDK now imports the adapter JSON directly via TideCloakProvider's config prop.
// This route remains available for any server-side consumers that need the config.
export async function GET() {
  try {
    const config = loadTideConfig();
    return Response.json(config);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Config not found" },
      { status: 500 }
    );
  }
}
