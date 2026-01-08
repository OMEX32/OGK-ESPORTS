import { kv } from "@vercel/kv";
import crypto from "crypto";

const TEAM_ID = process.env.TEAM_ID || "default";
const PIN_SALT = process.env.PIN_SALT || "";
const ADMIN_PIN = process.env.ADMIN_PIN || "";

type PlayerPublic = { username: string; active: boolean; updatedAt: string };

const playersKey = `r6:${TEAM_ID}:players`; // set of usernames
const playerDataKey = (u: string) => `r6:${TEAM_ID}:player:${u.toLowerCase()}`;

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function pinHash(username: string, pin: string) {
  // include username + salt to make reuse harder
  return sha256(`${PIN_SALT}::${username.toLowerCase()}::${pin}`);
}

function adminPinHash(pin: string) {
  return sha256(`${PIN_SALT}::ADMIN::${pin}`);
}

async function getAllPlayersPublic(): Promise<PlayerPublic[]> {
  const users = (await kv.smembers(playersKey)) as string[];
  const out: PlayerPublic[] = [];

  for (const username of users.sort((a, b) => a.localeCompare(b))) {
    const data = (await kv.get(playerDataKey(username))) as any | null;
    out.push({
      username,
      active: !!data?.active,
      updatedAt: data?.updatedAt || "",
    });
  }
  return out;
}

// Public: list players + statuses (no pins)
export async function GET() {
  const players = await getAllPlayersPublic();
  return Response.json({ ok: true, players });
}

/**
 * POST action router:
 *  - { action: "update", username, pin, active }
 *  - { action: "add", adminPin, username, pin }   // pin optional -> auto generate
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "").trim();

  if (action === "update") {
    const username = String(body.username || "").trim();
    const pin = String(body.pin || "").trim();
    const active = !!body.active;

    if (!username || !pin) {
      return Response.json({ ok: false, error: "Missing username or pin" }, { status: 400 });
    }

    const data = (await kv.get(playerDataKey(username))) as any | null;
    if (!data?.pinHash) {
      return Response.json({ ok: false, error: "Player not found" }, { status: 404 });
    }

    const ok = data.pinHash === pinHash(username, pin);
    if (!ok) {
      return Response.json({ ok: false, error: "Wrong PIN" }, { status: 401 });
    }

    const updatedAt = new Date().toISOString();
    await kv.set(playerDataKey(username), { ...data, active, updatedAt });

    return Response.json({ ok: true, player: { username, active, updatedAt } });
  }

  if (action === "add") {
    const adminPin = String(body.adminPin || "").trim();
    const username = String(body.username || "").trim();
    let pin = String(body.pin || "").trim();

    if (!ADMIN_PIN || !PIN_SALT) {
      return Response.json({ ok: false, error: "Server misconfigured (missing env vars)" }, { status: 500 });
    }
    if (!adminPin || !username) {
      return Response.json({ ok: false, error: "Missing adminPin or username" }, { status: 400 });
    }

    // verify admin pin
    const expected = adminPinHash(ADMIN_PIN);
    if (adminPinHash(adminPin) !== expected) {
      return Response.json({ ok: false, error: "Wrong admin PIN" }, { status: 401 });
    }

    // auto-generate player pin if not provided (4-digit)
    if (!pin) {
      pin = String(Math.floor(1000 + Math.random() * 9000));
    }

    const existing = (await kv.get(playerDataKey(username))) as any | null;
    if (existing) {
      return Response.json({ ok: false, error: "Player already exists" }, { status: 409 });
    }

    const record = {
      username,
      pinHash: pinHash(username, pin),
      active: false,
      updatedAt: "",
      createdAt: new Date().toISOString(),
    };

    await kv.sadd(playersKey, username);
    await kv.set(playerDataKey(username), record);

    // return the generated pin ONCE (so you can share it)
    return Response.json({ ok: true, username, pin });
  }

  return Response.json({ ok: false, error: "Invalid action" }, { status: 400 });
}
