const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const MAX_MEMBERS = 10;
const rooms = new Map();
const clientInfo = new Map();

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(file);
    const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "X-Content-Type-Options":"nosniff" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });
function send(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function members(room) {
  return [...(rooms.get(room) || [])].map(ws => ({ id: ws.id, name: ws.name }));
}
function relay(ws, msg) {
  const target = [...wss.clients].find(c => c.id === msg.to && c.readyState === WebSocket.OPEN);
  if (!target || !clientInfo.has(target)) return;
  send(target, { ...msg, from: ws.id, name: ws.name });
}
wss.on("connection", ws => {
  ws.id = Math.random().toString(36).slice(2, 12);
  ws.on("message", raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "join") {
      const room = String(msg.room || "").toUpperCase();
      const name = String(msg.name || "کاربر").slice(0, 20);
      if (!/^[A-Z0-9_-]{3,12}$/.test(room)) return send(ws, {type:"error",message:"کد گروه نامعتبر است."});
      let set = rooms.get(room);
      if (!set) { set = new Set(); rooms.set(room, set); }
      if (set.size >= MAX_MEMBERS) return send(ws, {type:"room-full"});
      const previous = [...set];
      ws.room = room; ws.name = name; set.add(ws); clientInfo.set(ws, true);
      send(ws, {type:"joined",id:ws.id,members:members(room),peers:previous.map(p=>({id:p.id,name:p.name}))});
      for (const peer of previous) send(peer, {type:"peer-joined",members:members(room),member:{id:ws.id,name:ws.name}});
      return;
    }
    if (!clientInfo.has(ws)) return;
    if (["offer","answer","ice","talking"].includes(msg.type)) relay(ws, msg);
  });
  ws.on("close", () => {
    clientInfo.delete(ws);
    if (!ws.room || !rooms.has(ws.room)) return;
    const set = rooms.get(ws.room); set.delete(ws);
    for (const peer of set) send(peer, {type:"peer-left",id:ws.id,members:members(ws.room)});
    if (!set.size) rooms.delete(ws.room);
  });
});
server.listen(PORT, "0.0.0.0", () => console.log(`Walkie Talkie Pro listening on ${PORT}`));
