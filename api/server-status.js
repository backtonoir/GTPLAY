// GTPLAY v3.4 (server status)
// ==================================================
// VERCEL SERVERLESS FUNCTION — /api/server-status
// --------------------------------------------------
// Mengambil status server dari API GTPS Cloud lalu
// mengembalikan JSON yang sudah dirapikan untuk landing
// page:
//   { online, players, peak, worlds, uptime, updatedAt }
//
// Hasil di-cache 30 detik di CDN Vercel, jadi API GTPS
// Cloud tidak dipanggil oleh setiap pengunjung.
//
// Server ID bisa diganti lewat Environment Variable
// GTPS_SERVER_ID di Vercel (Settings → Environment
// Variables) tanpa mengubah file ini.
// ==================================================

const SERVER_ID = process.env.GTPS_SERVER_ID || "18878";
const API_URL = `https://api.gtps.cloud/g-api/${encodeURIComponent(SERVER_ID)}/status`;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    if (!response.ok) throw new Error(`GTPS Cloud responded ${response.status}`);

    const data = await response.json();
    const status = String(data.server_status || data.status || "").toLowerCase();

    const body = {
      online: status === "online",
      players: toNumber(data.players_online ?? data.players),
      peak: toNumber(data.record_online),
      // API GTPS Cloud belum menyediakan jumlah world aktif.
      worlds: toNumber(data.worlds_active ?? data.active_worlds ?? data.worlds),
      uptime: typeof data.uptime === "string" ? data.uptime : null,
      updatedAt: new Date().toISOString()
    };

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json(body);
  } catch (error) {
    console.error("[server-status]", error && error.message);
    res.setHeader("Cache-Control", "public, s-maxage=10");
    return res.status(502).json({ error: "Status service unavailable" });
  } finally {
    clearTimeout(timer);
  }
};
