"use client";

import { useEffect, useState } from "react";

type Player = { username: string; active: boolean; updatedAt: string };

export default function Page() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [info, setInfo] = useState("");

  // update form
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [active, setActive] = useState(false);

  // add form
  const [adminPin, setAdminPin] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPin, setNewPin] = useState("");
  const [createdPin, setCreatedPin] = useState<string | null>(null);

  async function load() {
    setInfo("Loading...");
    try {
      const res = await fetch("/api/status");
      // Try JSON first; if not JSON, show text
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = { error: await res.text().catch(() => "Request failed") };
      }

      if (!res.ok) {
        setInfo(data.error || "Load failed");
        return;
      }

      const list: Player[] = data.players || [];
      setPlayers(list);

      // keep selected player's current status in the toggle
      const found = list.find((p) => p.username === username);
      if (found) setActive(!!found.active);

      setInfo(`Loaded ${list.length} players`);
    } catch (e: any) {
      setInfo(e?.message || "Load failed");
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Improvement #1: when switching user, update active AND clear the PIN field
  useEffect(() => {
    const found = players.find((p) => p.username === username);
    if (found) setActive(!!found.active);
    setPin(""); // clear pin when changing user
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  async function submitUpdate() {
    setInfo("Updating...");
    setCreatedPin(null);

    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          username,
          pin,
          active,
        }),
      });

      // Improvement #2: handle non-JSON errors too
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = { error: await res.text().catch(() => "Update failed") };
      }

      if (!res.ok) {
        setInfo(data.error || "Update failed");
        return;
      }

      setInfo(`Updated ${username}`);
      await load();
    } catch (e: any) {
      setInfo(e?.message || "Update failed");
    }
  }

  async function submitAdd() {
    setInfo("Adding player...");
    setCreatedPin(null);

    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          adminPin,
          username: newUsername,
          pin: newPin || undefined,
        }),
      });

      // Improvement #2: handle non-JSON errors too
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = { error: await res.text().catch(() => "Add failed") };
      }

      if (!res.ok) {
        setInfo(data.error || "Add failed");
        return;
      }

      setCreatedPin(data.pin); // show the generated pin once
      setInfo(`Added ${data.username}`);
      setNewUsername("");
      setNewPin("");
      await load();
    } catch (e: any) {
      setInfo(e?.message || "Add failed");
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 12px" }}>R6 Team Status</h1>
      <small style={{ color: "#666" }}>{info}</small>

      <section style={{ marginTop: 18, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Update my status</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <select value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle}>
            <option value="">Select your name…</option>
            {players.map((p) => (
              <option key={p.username} value={p.username}>
                {p.username}
              </option>
            ))}
          </select>

          <input
            placeholder="Your PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={inputStyle}
            inputMode="numeric"
          />

          <select value={String(active)} onChange={(e) => setActive(e.target.value === "true")} style={inputStyle}>
            <option value="true">Active</option>
            <option value="false">Not active</option>
          </select>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button onClick={submitUpdate} style={btnStyle} disabled={!username || !pin}>
            Save
          </button>
          <button onClick={load} style={btnStyle}>
            Refresh
          </button>
        </div>
      </section>

      <section style={{ marginTop: 16, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Add a player (captain only)</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <input
            placeholder="Admin PIN"
            value={adminPin}
            onChange={(e) => setAdminPin(e.target.value)}
            style={inputStyle}
            inputMode="numeric"
          />
          <input
            placeholder="New username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="New player PIN (optional)"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            style={inputStyle}
            inputMode="numeric"
          />
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={submitAdd} style={btnStyle} disabled={!adminPin || !newUsername}>
            Add player
          </button>

          {createdPin && (
            <small style={{ color: "#111" }}>
              Player PIN (share privately): <b>{createdPin}</b>
            </small>
          )}
        </div>

        <small style={{ display: "block", marginTop: 8, color: "#666" }}>
          If you leave “New player PIN” empty, it generates a random 4-digit PIN and shows it once.
        </small>
      </section>

      <section style={{ marginTop: 16 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>Roster</h2>
        {players.map((p) => (
          <div key={p.username} style={rowStyle}>
            <div style={{ fontWeight: 700 }}>{p.username}</div>
            <div style={{ justifySelf: "end" }}>{p.active ? "✅ Active" : "⛔ Not active"}</div>
          </div>
        ))}
      </section>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid #ccc",
};

const btnStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "#fff",
  cursor: "pointer",
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  padding: "10px 12px",
  border: "1px solid #eee",
  borderRadius: 12,
  marginBottom: 10,
};
