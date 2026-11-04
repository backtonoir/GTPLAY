// ==================================================
// SERVER UNTUK VPS / COOLIFY
// --------------------------------------------------
// Dipakai saat website di-host di VPS (mis. Coolify).
// Di Vercel file ini TIDAK dipakai — Vercel membaca
// vercel.json + folder api/ secara otomatis.
//
//   npm start                   → http://0.0.0.0:3000
//   PORT=8080 npm start         → port lain
//
// Environment variable (opsional):
//   PORT            port server (default 3000)
//   HOST            alamat listen (default 0.0.0.0)
//   GTPS_SERVER_ID  ID server GTPS Cloud (dibaca api/server-status.js)
//
// Meniru perilaku Vercel: URL tanpa .html, /admin/<tab>,
// header dari vercel.json, halaman 404, dan menjalankan
// file di folder api/ (/api/server-status, /api/og-image).
// Tanpa dependency — cukup Node.js 18+.
// ==================================================

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
// api/og-image.js membaca js/config.js relatif ke process.cwd().
process.chdir(ROOT);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

// Tidak boleh dibuka dari browser (kode server, SQL, file konfigurasi).
const BLOCKED =
  /^\/(api|supabase|node_modules)(\/|$)|^\/(server\.js|package(-lock)?\.json|vercel\.json|Dockerfile|README\.md)$|\/\./i;

// --------------------------------------------------
// Header dari vercel.json
// --------------------------------------------------
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

function sourceToRegex(source) {
  // Mendukung pola yang dipakai di vercel.json: "/(.*)", "/images/(.*)", "/admin/:tab".
  const pattern = source
    .split("(.*)")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z_]+/g, "[^/]+"))
    .join(".*");
  return new RegExp(`^${pattern}$`);
}

const headerRules = (vercel.headers || []).map((rule) => ({
  test: sourceToRegex(rule.source),
  headers: rule.headers || []
}));

function applyHeaders(res, pathname) {
  for (const rule of headerRules) {
    if (rule.test.test(pathname)) {
      for (const { key, value } of rule.headers) res.setHeader(key, value);
    }
  }
}

// --------------------------------------------------
// Fungsi di folder api/
// --------------------------------------------------
const apiHandlers = new Map();
const apiDir = path.join(ROOT, "api");
if (fs.existsSync(apiDir)) {
  for (const file of fs.readdirSync(apiDir)) {
    if (file.endsWith(".js")) {
      apiHandlers.set(`/api/${file.slice(0, -3)}`, require(path.join(apiDir, file)));
    }
  }
}

// --------------------------------------------------

function fileIfExists(p) {
  try {
    return fs.statSync(p).isFile() ? p : null;
  } catch {
    return null;
  }
}

function sendFile(res, status, file, pathname, method) {
  applyHeaders(res, pathname);
  res.statusCode = status;
  res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  if (method === "HEAD") return res.end();
  const stream = fs.createReadStream(file);
  stream.on("error", () => {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  stream.pipe(res);
}

function redirect(res, location) {
  res.statusCode = 308;
  res.setHeader("Location", location);
  res.end();
}

const server = http.createServer(async (req, res) => {
  let url;
  let pathname;
  try {
    url = new URL(req.url, "http://localhost");
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    return res.end("Bad request");
  }

  // /api/server-status, /api/og-image
  const handler = apiHandlers.get(pathname);
  if (handler) {
    applyHeaders(res, pathname);
    try {
      await handler(req, res);
    } catch (error) {
      console.error(`[api] ${pathname}`, error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify({ error: "internal_error" }));
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return res.end();
  }

  // cleanUrls: /store.html → /store, /index.html → /
  if (pathname.endsWith(".html")) {
    const clean = pathname === "/index.html" ? "/" : pathname.slice(0, -5);
    return redirect(res, clean + url.search);
  }
  // trailingSlash: false
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return redirect(res, pathname.replace(/\/+$/, "") + url.search);
  }

  const notFound = () => sendFile(res, 404, path.join(ROOT, "404.html"), pathname, req.method);
  if (BLOCKED.test(pathname)) return notFound();

  // rewrites: /admin/:tab → /admin
  if (/^\/admin\/[^/]+$/.test(pathname)) {
    return sendFile(res, 200, path.join(ROOT, "admin.html"), pathname, req.method);
  }

  const target = path.normalize(path.join(ROOT, pathname));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return notFound();

  const file =
    (pathname === "/" && fileIfExists(path.join(ROOT, "index.html"))) ||
    fileIfExists(target) ||
    fileIfExists(target + ".html");

  if (!file) return notFound();
  sendFile(res, 200, file, pathname, req.method);
});

server.listen(PORT, HOST, () => {
  console.log(`Website berjalan di http://${HOST}:${PORT}`);
});

// Berhenti dengan rapi saat container di-restart.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
