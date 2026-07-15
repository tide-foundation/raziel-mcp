"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useState, useEffect, useCallback } from "react";

interface VaultEntry {
  id: string;
  label: string;
  ciphertext: string;
  createdAt: string;
}

export default function VaultPage() {
  const { authenticated, login, logout, getValueFromIdToken, token, doEncrypt, doDecrypt, isInitializing } =
    useTideCloak();

  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const TAG = "vault";

  const fetchEntries = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/vault", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries);
      }
    } catch {
      setStatus("Failed to load vault entries.");
    }
  }, [token]);

  useEffect(() => {
    if (authenticated && token) {
      fetchEntries();
    }
  }, [authenticated, token, fetchEntries]);

  if (isInitializing) {
    return <p>Loading...</p>;
  }

  if (!authenticated) {
    return (
      <div style={{ maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
        <p>You must be logged in to access the vault.</p>
        <button onClick={login} style={btnPrimary}>
          Login with Tide
        </button>
      </div>
    );
  }

  const handleEncryptAndStore = async () => {
    if (!label.trim() || !secret.trim()) {
      setStatus("Label and secret are required.");
      return;
    }

    setLoading(true);
    setStatus("Encrypting via Tide Fabric...");

    try {
      // Self-encryption: only this user can ever decrypt
      const result = await doEncrypt([{ data: secret, tags: [TAG] }]);
      const ciphertext = result[0];

      setStatus("Storing encrypted entry...");
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label: label.trim(), ciphertext }),
      });

      if (!res.ok) {
        const err = await res.json();
        setStatus(`Store failed: ${err.error}`);
        return;
      }

      setLabel("");
      setSecret("");
      setStatus("Encrypted and stored.");
      await fetchEntries();
    } catch (err: any) {
      setStatus(`Encrypt failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDecrypt = async (entry: VaultEntry) => {
    setLoading(true);
    setStatus(`Decrypting "${entry.label}" via Tide Fabric...`);

    try {
      // Self-decryption: only the user who encrypted can decrypt
      const result = await doDecrypt([
        { encrypted: entry.ciphertext, tags: [TAG] },
      ]);
      const plaintext = result[0];

      setDecrypted((prev) => ({ ...prev, [entry.id]: plaintext }));
      setStatus("Decrypted.");
    } catch (err: any) {
      setStatus(`Decrypt failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/vault?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setDecrypted((prev) => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
        await fetchEntries();
        setStatus("Entry deleted.");
      }
    } catch {
      setStatus("Delete failed.");
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "2rem auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <h1 style={{ margin: 0 }}>Vault</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ color: "#999", fontSize: "0.9rem" }}>{getValueFromIdToken("preferred_username")}</span>
          <a href="/" style={{ ...btnSmall, background: "#333", textDecoration: "none" }}>Home</a>
          <button onClick={logout} style={{ ...btnSmall, background: "#333" }}>Logout</button>
        </div>
      </div>

      {/* Encrypt new secret */}
      <div style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Encrypt a Secret</h2>
        <input
          type="text"
          placeholder="Label (e.g. API Key)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={inputStyle}
        />
        <textarea
          placeholder="Secret data to encrypt..."
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <button
          onClick={handleEncryptAndStore}
          disabled={loading}
          style={btnPrimary}
        >
          {loading ? "Working..." : "Encrypt & Store"}
        </button>
      </div>

      {/* Status */}
      {status && (
        <p style={{ color: "#60a5fa", fontSize: "0.9rem", margin: "1rem 0" }}>
          {status}
        </p>
      )}

      {/* Vault entries */}
      <h2>Stored Secrets ({entries.length})</h2>
      {entries.length === 0 && (
        <p style={{ color: "#666" }}>No secrets stored yet. Encrypt one above.</p>
      )}
      {entries.map((entry) => (
        <div key={entry.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{entry.label}</strong>
            <span style={{ color: "#666", fontSize: "0.8rem" }}>
              {new Date(entry.createdAt).toLocaleString()}
            </span>
          </div>

          <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", wordBreak: "break-all" }}>
            {decrypted[entry.id] ? (
              <div style={{ background: "#1a3a1a", padding: "0.75rem", borderRadius: 4 }}>
                <div style={{ color: "#4ade80", marginBottom: "0.25rem" }}>Decrypted:</div>
                <div>{decrypted[entry.id]}</div>
              </div>
            ) : (
              <div style={{ background: "#1a1a2e", padding: "0.75rem", borderRadius: 4, color: "#666" }}>
                {entry.ciphertext.substring(0, 80)}...
              </div>
            )}
          </div>

          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
            {!decrypted[entry.id] && (
              <button
                onClick={() => handleDecrypt(entry)}
                disabled={loading}
                style={btnPrimary}
              >
                Decrypt
              </button>
            )}
            {decrypted[entry.id] && (
              <button
                onClick={() =>
                  setDecrypted((prev) => {
                    const copy = { ...prev };
                    delete copy[entry.id];
                    return copy;
                  })
                }
                style={{ ...btnSmall, background: "#555" }}
              >
                Hide
              </button>
            )}
            <button
              onClick={() => handleDelete(entry.id)}
              style={{ ...btnSmall, background: "#7f1d1d" }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "0.6rem 1.2rem",
  fontSize: "0.95rem",
  cursor: "pointer",
};

const btnSmall: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  padding: "0.4rem 0.8rem",
  fontSize: "0.85rem",
  cursor: "pointer",
};

const cardStyle: React.CSSProperties = {
  background: "#111",
  border: "1px solid #333",
  borderRadius: 8,
  padding: "1.25rem",
  marginBottom: "1rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem",
  marginBottom: "0.75rem",
  background: "#1a1a1a",
  border: "1px solid #333",
  borderRadius: 4,
  color: "#ededed",
  fontSize: "0.95rem",
  boxSizing: "border-box",
};
