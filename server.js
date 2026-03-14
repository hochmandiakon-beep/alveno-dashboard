const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ALVENO_BASE = "https://api.alveno.cz/v1/RESTAPIService.svc";

// Token: from env variable (set in Render dashboard) or set via API
let API_TOKEN = process.env.ALVENO_TOKEN || "";

function proxyAlveno(endpoint, method, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(ALVENO_BASE + "/" + endpoint);
    const opts = {
      hostname: parsed.hostname, port: 443, path: parsed.path,
      method: method || "GET",
      headers: { "Content-Type": "application/json; charset=utf-8", "AuthorizationToken": API_TOKEN, "Accept-Encoding": "identity" }
    };
    const req = https.request(opts, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", e => reject(e));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  let p = parsed.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Static files
  if (p === "/") p = "/index.html";
  const filePath = path.join(__dirname, p);
  if (fs.existsSync(filePath) && !p.startsWith("/api")) {
    const ext = path.extname(p);
    res.writeHead(200, { "Content-Type": (MIME[ext] || "application/octet-stream") + "; charset=utf-8", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400" });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // API: Set token
  if (p === "/api/settoken" && req.method === "POST") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const d = JSON.parse(body);
        if (d.token) { API_TOKEN = d.token; res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); }
        else { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "Chybí token" })); }
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: e.message })); }
    });
    return;
  }

  // API: Status
  if (p === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, hasToken: !!API_TOKEN, preview: API_TOKEN ? API_TOKEN.slice(0, 8) + "..." : null }));
    return;
  }

  // API: Proxy to Alveno
  if (p.startsWith("/api/alveno/")) {
    const endpoint = p.replace("/api/alveno/", "") + (parsed.search || "");
    if (!API_TOKEN) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Token není nastaven" })); return; }

    let body = "";
    if (req.method === "POST") await new Promise(r => { req.on("data", c => body += c); req.on("end", r); });

    try {
      const result = await proxyAlveno(endpoint, req.method, body || null);
      res.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(result.body);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Alveno API: " + e.message }));
    }
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n🏢 Alveno Manager Hub running on port ${PORT}\n   Token: ${API_TOKEN ? "✅ set from env" : "⚙️  set via dashboard"}\n`);
});
