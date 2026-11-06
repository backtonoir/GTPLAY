// ==================================================
// /api/keepalive — mencegah Supabase di-pause
// --------------------------------------------------
// Supabase paket gratis mem-pause project yang tidak aktif
// selama 1 minggu. Vercel Cron memanggil endpoint ini setiap
// hari (lihat "crons" di vercel.json) untuk menjalankan satu
// query ringan, sehingga project selalu dianggap aktif.
//
// Alamat Supabase: env SUPABASE_URL + SUPABASE_ANON_KEY,
// atau otomatis dibaca dari js/config.js (anon key = publik).
// Opsional: set env CRON_SECRET di Vercel agar hanya cron
// Vercel yang boleh memanggil endpoint ini.
// ==================================================

const fs = require("fs");
const path = require("path");

function supabaseConfig() {
  let url = process.env.SUPABASE_URL || "";
  let key = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) {
    try {
      const source = fs.readFileSync(path.join(process.cwd(), "js", "config.js"), "utf8");
      url = url || (source.match(/SUPABASE_URL:\s*"([^"]*)"/) || [])[1] || "";
      key = key || (source.match(/SUPABASE_ANON_KEY:\s*"([^"]*)"/) || [])[1] || "";
    } catch (error) {
      /* config tidak terbaca */
    }
  }
  return { url: url.replace(/\/+$/, ""), key };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return;
  }

  const { url, key } = supabaseConfig();
  if (!url || !key) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: "Supabase is not configured" }));
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const started = Date.now();
  try {
    // Query ringan ke database (sama seperti saat pengunjung membuka website).
    const response = await fetch(`${url}/rest/v1/rpc/get_store_status`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal
    });
    res.statusCode = response.ok ? 200 : 502;
    res.end(JSON.stringify({ ok: response.ok, status: response.status, ms: Date.now() - started, at: new Date().toISOString() }));
  } catch (error) {
    res.statusCode = 502;
    res.end(JSON.stringify({ ok: false, error: error.name === "AbortError" ? "timeout" : "fetch failed" }));
  } finally {
    clearTimeout(timer);
  }
};
