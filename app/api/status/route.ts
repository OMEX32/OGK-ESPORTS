// app/api/status/route.ts
import crypto from "crypto";
import { createClient, type RedisClientType } from "redis";

const TEAM_ID = process.env.TEAM_ID || "default";
const PIN_SALT = process.env.PIN_SALT || "";
const ADMIN_PIN = process.env.ADMIN_PIN || "";
const REDIS_URL = process.env.REDIS_URL || "";

type PlayerPublic = { username: string; active: boolean; updatedAt: string };
type PlayerRecord = {
  username: string;
  pinHash: string;
  active: boolean;
  updatedAt: string;
  createdAt: string;
};

const playersKey = `r6:${TEAM_ID}:players`;
const playerDataKey = (u: string) => `r6:${TEAM_ID}:player:${u.toLowerCase()}`;

// ---- Redis singleton ----
let redisClient: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

function getRedis(): RedisClientType {
  if (!REDIS_URL) throw new Error("Missing REDIS_URL env var");
  if (!redisClient) {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on("error", (err) => console.error("Redis Client Error", err));
  }
  return redisClient;
}

async function ensureRedisConnected() {
  const client = getRedis();
  if (client.isOpen) return;

  if (!connectPromise) {
    connectPromise = client.connect().finally(() => {
      connectPromise = null;
    });
  }
  await connectPromise;
}

// ---- hashing ----
function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function pinHash(username: string, pin: string) {
  return sha256(`${PIN_SALT}::${username.toLowerCase()}::${pin}`);
}
function adminPinHash(pin: string) {
  return sha256(`${PIN_SALT}::ADMIN::${pin}`);
}
function adminOk(inputPin: string) {
  const expected = adminPinHash(ADMIN_PIN);
  return adminPinHash(inputPin) === expected;
}

// ---- helpers ----
async function getPlayer(username: string): Promise<PlayerRecord | null> {
  await ensureRedisConnected();
  const client = getRedis();
  const raw = await client.get(playerDataKey(username));
  return raw ? (JSON.parse(raw) as PlayerRecord) : null;
}

async function setPlayer(username: string, record: PlayerRecord) {
  await ensureRedisConnected();
  const client = getRedis();
  await client.set(playerDataKey(username), JSON.stringify(record));
}

async function getAllPlayersPublic(): Promise<PlayerPublic[]> {
  await ensureRedisConnected();
  const client = getRedis();

  const users = await client.sMembers(playersKey);
  const out: PlayerPublic[] = [];

  for (const username of users.sort((a, b) => a.localeCompare(b))) {
    const data = await getPlayer(username);
    out.push({
      username,
      active: !!data?.active,
      updatedAt: data?.updatedAt || "",
    });
  }
  return out;
}

// Public: list players + statuses
export async function GET() {
  try {
    const players = await getAllPlayersPublic();
    return Response.json({ ok: true, players });
  } catch (err: any) {
    console.error(err);
    return Response.json({ ok: false, error: err?.message || "Server error" }, { status: 500 });
  }
}

/**
 * POST actions:
 *  - update: { action:"update", username, pin, active }
 *  - add:    { action:"add", adminPin, username, pin? }
 *  - remove: { action:"remove", adminPin, username }
 */
export async function POST(req: Request) {
  try {
    if (!PIN_SALT) {
      return Response.json({ ok: false, error: "Server misconfigured (PIN_SALT missing)" }, { status: 500 });
    }
    if (!ADMIN_PIN) {
      return Response.json({ ok: false, error: "Server misconfigured (ADMIN_PIN missing)" }, { status: 500 });
    }

    await ensureRedisConnected();
    const client = getRedis();

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    if (action === "update") {
      const username = String(body.username || "").trim();
      const pin = String(body.pin || "").trim();
      const active = !!body.active;

      if (!username || !pin) {
        return Response.json({ ok: false, error: "Missing username or pin" }, { status: 400 });
      }

      const data = await getPlayer(username);
      if (!data?.pinHash) {
        return Response.json({ ok: false, error: "Player not found" }, { status: 404 });
      }

      if (data.pinHash !== pinHash(username, pin)) {
        return Response.json({ ok: false, error: "Wrong PIN" }, { status: 401 });
      }

      const updatedAt = new Date().toISOString();
      await setPlayer(username, { ...data, active, updatedAt });

      return Response.json({ ok: true, player: { username, active, updatedAt } });
    }

    if (action === "add") {
      const adminPin = String(body.adminPin || "").trim();
      const username = String(body.username || "").trim();
      let pin = String(body.pin || "").trim();

      if (!adminPin || !username) {
        return Response.json({ ok: false, error: "Missing adminPin or username" }, { status: 400 });
      }
      if (!adminOk(adminPin)) {
        return Response.json({ ok: false, error: "Wrong admin PIN" }, { status: 401 });
      }

      if (!pin) pin = String(Math.floor(1000 + Math.random() * 9000));

      const existing = await getPlayer(username);
      if (existing) {
        return Response.json({ ok: false, error: "Player already exists" }, { status: 409 });
      }

      const record: PlayerRecord = {
        username,
        pinHash: pinHash(username, pin),
        active: false,
        updatedAt: "",
        createdAt: new Date().toISOString(),
      };

      await client.sAdd(playersKey, username);
      await client.set(playerDataKey(username), JSON.stringify(record));

      return Response.json({ ok: true, username, pin });
    }

    if (action === "remove") {
      const adminPin = String(body.adminPin || "").trim();
      const username = String(body.username || "").trim();

      if (!adminPin || !username) {
        return Response.json({ ok: false, error: "Missing adminPin or username" }, { status: 400 });
      }
      if (!adminOk(adminPin)) {
        return Response.json({ ok: false, error: "Wrong admin PIN" }, { status: 401 });
      }

      // remove from roster + delete record
      await client.sRem(playersKey, username);
      await client.del(playerDataKey(username));

      return Response.json({ ok: true, removed: username });
    }

    return Response.json({ ok: false, error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error(err);
    return Response.json({ ok: false, error: err?.message || "Server error" }, { status: 500 });
  }
}
