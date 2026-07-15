import { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/middleware";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Filesystem store for vault entries. Survives Next.js dev hot reload.
// In-memory stores (Map, Array) reset on every file change in dev mode.
// For production, replace with a real database.
const DATA_DIR = join(process.cwd(), "data", "vault");
mkdirSync(DATA_DIR, { recursive: true });

interface VaultEntry {
  id: string;
  label: string;
  ciphertext: string;
  createdAt: string;
}

function readEntries(userId: string): VaultEntry[] {
  try {
    const filePath = join(DATA_DIR, `${userId}.json`);
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

function writeEntries(userId: string, entries: VaultEntry[]): void {
  const filePath = join(DATA_DIR, `${userId}.json`);
  writeFileSync(filePath, JSON.stringify(entries, null, 2));
}

// GET /api/vault — list all vault entries for the authenticated user (ciphertext only)
export const GET = withAuth(async (_req, jwt) => {
  const userId = jwt.sub!;
  const entries = readEntries(userId);
  return Response.json({ entries });
});

// POST /api/vault — store a new encrypted entry
// Body: { label: string, ciphertext: string }
// The server never sees plaintext. Encryption happens client-side via Tide SDK.
export const POST = withAuth(async (req, jwt) => {
  const userId = jwt.sub!;
  const body = await req.json();

  const { label, ciphertext } = body;
  if (!label || typeof label !== "string" || label.length > 200) {
    return Response.json({ error: "Invalid label" }, { status: 400 });
  }
  if (!ciphertext || typeof ciphertext !== "string") {
    return Response.json({ error: "Missing ciphertext" }, { status: 400 });
  }

  const entry: VaultEntry = {
    id: randomUUID(),
    label,
    ciphertext,
    createdAt: new Date().toISOString(),
  };

  const entries = readEntries(userId);
  entries.push(entry);
  writeEntries(userId, entries);

  return Response.json({ entry }, { status: 201 });
});

// DELETE /api/vault?id=<entryId> — delete a vault entry
export const DELETE = withAuth(async (req, jwt) => {
  const userId = jwt.sub!;
  const url = new URL(req.url);
  const entryId = url.searchParams.get("id");

  if (!entryId) {
    return Response.json({ error: "Missing id parameter" }, { status: 400 });
  }

  const entries = readEntries(userId);
  const idx = entries.findIndex((e) => e.id === entryId);
  if (idx === -1) {
    return Response.json({ error: "Entry not found" }, { status: 404 });
  }

  entries.splice(idx, 1);
  writeEntries(userId, entries);
  return Response.json({ success: true });
});
