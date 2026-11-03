// ==================================================
// /api/og-image — gambar preview link (WhatsApp, Discord, Google)
// --------------------------------------------------
// Crawler preview link tidak menjalankan JavaScript, jadi
// <meta property="og:image"> di semua halaman menunjuk ke sini.
// Fungsi ini membaca OG Image dari Admin → Server dan
// mengalihkan (302) ke gambar tersebut, atau ke gambar bawaan.
//
// Alamat Supabase: env SUPABASE_URL + SUPABASE_ANON_KEY,
// atau otomatis dibaca dari js/config.js (anon key = publik).
// ==================================================

const fs = require("fs");
const path = require("path");

const FALLBACK = "/images/brand/og-image.jpg";

function supabaseConfig() {
  let url = process.env.SUPABASE_URL || "";
  let key = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) {
    try {
      const source = fs.readFileSync(path.join(process.cwd(), "js", "config.js"), "utf8");
      url = url || (source.match(/SUPABASE_URL:\s*"([^"]*)"/) || [])[1] || "";
      key = key || (source.match(/SUPABASE_ANON_KEY:\s*"([^"]*)"/) || [])[1] || "";
    } catch (error) {
      /* config tidak terbaca → pakai gambar bawaan */
    }
  }
  return { url: url.replace(/\/+$/, ""), key };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    res.end();
    return;
  }

  let target = FALLBACK;
  const { url, key } = supabaseConfig();

  if (url && key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(`${url}/rest/v1/rpc/get_store_status`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal
      });
      if (response.ok) {
        const status = await response.json();
        const og = status && status.site && status.site.images && status.site.images.ogImage;
        if (typeof og === "string" && /^https:\/\/[^\s<>"]+$/.test(og)) target = og;
      }
    } catch (error) {
      /* Supabase tidak terjangkau → gambar bawaan */
    } finally {
      clearTimeout(timer);
    }
  }

  res.statusCode = 302;
  res.setHeader("Location", target);
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  res.end();
};
