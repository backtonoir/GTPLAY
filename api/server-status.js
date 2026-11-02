// GTPLAY v3.6 (GTPS Cloud public API)
// ==================================================
// GET /api/server-status
// --------------------------------------------------
// Mengambil status server dari API publik GTPS Cloud
// lalu mengembalikan JSON ringkas untuk landing page:
//   { online, players, worlds, maxPlayers, uptime, updatedAt }
//
// Hanya field yang dibutuhkan yang diteruskan — IP server,
// port, dan info akun dari GTPS Cloud TIDAK dikirim ke browser.
//
// Ganti server ID lewat Vercel → Settings → Environment
// Variables → GTPS_SERVER_ID (default 6986).
// ==================================================

const SERVER_ID = String(process.env.GTPS_SERVER_ID || "6986").replace(/\D/g, "");
const UPSTREAM = `https://api.gtps.cloud/api/server/public/${SERVER_ID}`;

function toNumber(value) {
  const n = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(n) ? null : n;
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const upstream = await fetch(UPSTREAM, {
      headers: { Accept: "application/json", "User-Agent": "GTPLAY-Website/1.0" },
      signal: controller.signal
    });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);

    const data = await upstream.json();
    const state = (data && data.state) || {};
    const online = Number(state.server_status) === 1;
    const nowSec = Math.floor(Date.now() / 1000);
    const since = toNumber(state.server_status_changed);

    const body = {
      online,
      players: online ? toNumber(state.players_online) : 0,
      worlds: online ? toNumber(state.active_worlds) : 0,
      maxPlayers: toNumber(data.tier_info && data.tier_info.max_players_online),
      uptime: online && since ? formatUptime(nowSec - since) : null,
      updatedAt: new Date().toISOString()
    };

    // Cache di edge Vercel 30 detik → API GTPS Cloud tidak dibanjiri request.
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    res.statusCode = 200;
    res.end(JSON.stringify(body));
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 502;
    res.end(JSON.stringify({ error: "status_unavailable" }));
  } finally {
    clearTimeout(timer);
  }
};
