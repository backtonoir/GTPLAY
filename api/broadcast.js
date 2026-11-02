// GTPLAY v4.0 — Broadcast In-Game
// ==================================================
// POST /api/broadcast
// --------------------------------------------------
// Mengirim pesan broadcast ke server game GTPS Cloud.
// Admin-only: JWT dari Supabase Auth diverifikasi di sini,
// bukan di browser.
//
// Env vars (Vercel → Settings → Environment Variables):
//   SUPABASE_URL            — URL project Supabase (wajib)
//   SUPABASE_SERVICE_ROLE_KEY — service role key (wajib, RAHASIA)
//   GTPS_SERVER_ID          — instance ID server (default: 6986)
//   GTPS_CLOUD_API_KEY      — API key dashboard GTPS Cloud (wajib)
//   GTPS_BROADCAST_ENDPOINT — override endpoint broadcast
//                              (default: https://api.gtps.cloud/api/server/{id}/console)
//
// KEAMANAN:
//   • Service role key & GTPS API key hanya ada di env var.
//   • Frontend TIDAK menyimpan atau mengirim kredensial server.
//   • Setiap request dicek: (1) JWT valid, (2) user ada di admins.
//   • Pesan divalidasi & disanitasi sebelum dikirim.
//   • Setiap broadcast dicatat di tabel broadcast_messages.
// ==================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SERVER_ID = String(process.env.GTPS_SERVER_ID || "6986").replace(/\D/g, "");
const GTPS_API_KEY = process.env.GTPS_CLOUD_API_KEY || "";

// Default endpoint: GTPS Cloud console API (server-side only).
// Configurable via env var for flexibility.
const BROADCAST_ENDPOINT = process.env.GTPS_BROADCAST_ENDPOINT
  || `https://api.gtps.cloud/api/server/${SERVER_ID}/console`;

// ── Helpers ──────────────────────────────────────

function json(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

// Verify Supabase JWT and check admin status using service role key.
// Returns { ok, userId, error }.
async function verifyAdmin(token) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { ok: false, error: "server_misconfigured" };
  }

  // 1) Resolve the JWT to a user via Supabase Auth admin API.
  let userId;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SERVICE_ROLE_KEY
      }
    });
    if (!userRes.ok) return { ok: false, error: "invalid_token" };
    const user = await userRes.json();
    userId = user.id;
    if (!userId) return { ok: false, error: "invalid_token" };
  } catch {
    return { ok: false, error: "auth_unavailable" };
  }

  // 2) Check the admins table via service role (bypasses RLS).
  try {
    const adminRes = await fetch(
      `${SUPABASE_URL}/rest/v1/admins?user_id=eq.${userId}&select=user_id`,
      {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`
        }
      }
    );
    if (!adminRes.ok) return { ok: false, error: "admin_check_failed" };
    const rows = await adminRes.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: "not_admin" };
    }
  } catch {
    return { ok: false, error: "admin_check_failed" };
  }

  return { ok: true, userId };
}

// Log broadcast attempt to the broadcast_messages table.
async function logBroadcast(userId, message, status, response) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/broadcast_messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        message: message.slice(0, 500),
        sent_by: userId,
        status,
        response: typeof response === "string" ? response.slice(0, 1000) : null
      })
    });
  } catch {
    // Logging failure should not break the response.
  }
}

// Sanitise broadcast message: strip control characters, limit length.
function sanitiseMessage(raw) {
  if (!raw || typeof raw !== "string") return null;
  // Remove control chars except space, limit to 500 chars.
  const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, "").trim();
  if (cleaned.length === 0 || cleaned.length > 500) return null;
  return cleaned;
}

// ── Handler ──────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS: admin panel is same-origin, but allow preflight just in case.
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
    return json(res, 204, null);
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return json(res, 405, { error: "method_not_allowed" });
  }

  // ── Auth ────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json(res, 401, { error: "unauthorized" });
  }

  const auth = await verifyAdmin(authHeader.slice(7));
  if (!auth.ok) {
    const status = auth.error === "not_admin" ? 403 : 401;
    return json(res, status, { error: auth.error });
  }

  // ── Validate message ────────────────────────
  const body = req.body || {};
  const message = sanitiseMessage(body.message);
  if (!message) {
    return json(res, 400, {
      error: "invalid_message",
      detail: "Message must be 1–500 printable characters."
    });
  }

  // ── Check config ────────────────────────────
  if (!GTPS_API_KEY) {
    await logBroadcast(auth.userId, message, "failed", "GTPS_CLOUD_API_KEY not configured");
    return json(res, 503, {
      error: "broadcast_not_configured",
      detail: "GTPS_CLOUD_API_KEY is not set. Add it in Vercel → Environment Variables."
    });
  }

  // ── Send broadcast ──────────────────────────
  // GTPS Cloud console API pattern: send a /broadcast command.
  // The command format follows Growtopia server convention:
  //   /broadcast <message>
  const command = `/broadcast ${message}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  let upstreamOk = false;
  let upstreamBody = "";

  try {
    const upstream = await fetch(BROADCAST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${GTPS_API_KEY}`,
        "User-Agent": "GTPLAY-Website/1.0"
      },
      body: JSON.stringify({ command }),
      signal: controller.signal
    });

    upstreamBody = await upstream.text();
    upstreamOk = upstream.ok;

    if (!upstreamOk) {
      await logBroadcast(auth.userId, message, "failed", `HTTP ${upstream.status}: ${upstreamBody.slice(0, 500)}`);
      return json(res, 502, {
        error: "broadcast_failed",
        detail: `Game server returned status ${upstream.status}.`
      });
    }
  } catch (err) {
    const reason = err.name === "AbortError" ? "timeout" : err.message;
    await logBroadcast(auth.userId, message, "failed", reason);
    return json(res, 502, {
      error: "broadcast_failed",
      detail: "Could not reach the game server. Check GTPS_BROADCAST_ENDPOINT and GTPS_CLOUD_API_KEY."
    });
  } finally {
    clearTimeout(timer);
  }

  // ── Success ─────────────────────────────────
  await logBroadcast(auth.userId, message, "sent", upstreamBody.slice(0, 500));

  return json(res, 200, {
    ok: true,
    message,
    sentAt: new Date().toISOString()
  });
};
