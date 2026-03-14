const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ALVENO_BASE = "https://api.alveno.cz/v1/RESTAPIService.svc";
let API_TOKEN = process.env.ALVENO_TOKEN || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

function httpsReq(hostname, reqPath, method, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, port: 443, path: reqPath, method: method || "GET", headers: headers || {} };
    const req = https.request(opts, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", e => reject(e));
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json" };

http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  let p = parsed.pathname;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Static files
  if (p === "/") p = "/index.html";
  if (!p.startsWith("/api")) {
    const fp = path.join(__dirname, p);
    if (fs.existsSync(fp)) {
      const ext = path.extname(p);
      res.writeHead(200, { "Content-Type": (MIME[ext] || "application/octet-stream") + "; charset=utf-8" });
      fs.createReadStream(fp).pipe(res);
      return;
    }
  }

  // Read body helper
  async function readBody() {
    return new Promise(r => { let b = ""; req.on("data", c => b += c); req.on("end", () => r(b)); });
  }

  // API: status
  if (p === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, hasToken: !!API_TOKEN, hasAI: !!ANTHROPIC_KEY }));
    return;
  }

  // API: set token
  if (p === "/api/settoken" && req.method === "POST") {
    const body = await readBody();
    try { const d = JSON.parse(body); if (d.token) { API_TOKEN = d.token; res.writeHead(200, {"Content-Type":"application/json"}); res.end(JSON.stringify({ok:true})); } else throw new Error("missing"); }
    catch(e) { res.writeHead(400, {"Content-Type":"application/json"}); res.end(JSON.stringify({ok:false,error:e.message})); }
    return;
  }

  // API: Proxy to Alveno
  if (p.startsWith("/api/alveno/")) {
    if (!API_TOKEN) { res.writeHead(401, {"Content-Type":"application/json"}); res.end(JSON.stringify({error:"No token"})); return; }
    const endpoint = p.replace("/api/alveno/", "") + (parsed.search || "");
    const alvenoUrl = url.parse(ALVENO_BASE + "/" + endpoint);
    let body = null;
    if (req.method === "POST") body = await readBody();
    try {
      const r = await httpsReq(alvenoUrl.hostname, alvenoUrl.path, req.method, {
        "Content-Type": "application/json; charset=utf-8", "AuthorizationToken": API_TOKEN, "Accept-Encoding": "identity"
      }, body);
      res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(r.body);
    } catch(e) { res.writeHead(502, {"Content-Type":"application/json"}); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // API: AI Chat proxy
  if (p === "/api/chat" && req.method === "POST") {
    if (!ANTHROPIC_KEY) {
      res.writeHead(200, {"Content-Type":"application/json"});
      res.end(JSON.stringify({content:[{type:"text",text:"⚠️ AI asistent není aktivní.\n\nPro aktivaci přidejte v Render.com → váš service → Environment novou proměnnou:\n\nKey: ANTHROPIC_API_KEY\nValue: váš klíč z console.anthropic.com → API Keys\n\nPo uložení se service restartuje a chat začne fungovat."}]}));
      return;
    }
    const body = await readBody();
    try {
      const r = await httpsReq("api.anthropic.com", "/v1/messages", "POST", {
        "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01"
      }, body);
      res.writeHead(r.status, {"Content-Type":"application/json; charset=utf-8"});
      res.end(r.body);
    } catch(e) { res.writeHead(502, {"Content-Type":"application/json"}); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  res.writeHead(404); res.end("Not found");
}).listen(PORT, () => console.log(`\n🏢 Alveno Manager Hub → http://localhost:${PORT}\n   Alveno token: ${API_TOKEN?"✅":"❌"}  |  AI key: ${ANTHROPIC_KEY?"✅":"❌"}\n`));
