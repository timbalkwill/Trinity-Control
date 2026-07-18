import http from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dbPath = path.join(__dirname, "data", "db.json");
const port = Number(process.env.PORT || 4173);

const types = {
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8"
};

const readDb = async () => JSON.parse(await readFile(dbPath, "utf8"));
const writeDb = async db => writeFile(dbPath, JSON.stringify(db, null, 2));

function send(res, status, value) {
  res.writeHead(status, {"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
  res.end(JSON.stringify(value));
}
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function log(db, action, detail="") {
  db.liveState.history.unshift({time:new Date().toISOString(), action, detail});
  db.liveState.history = db.liveState.history.slice(0, 100);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);

    if (u.pathname === "/api/state" && req.method === "GET") return send(res, 200, await readDb());

    if (u.pathname === "/api/live/start" && req.method === "POST") {
      const db = await readDb();
      Object.assign(db.liveState, {active:true, paused:false, cueIndex:0, startedAt:new Date().toISOString()});
      log(db, "Service started", db.runsOfService[0].name);
      await writeDb(db);
      return send(res, 200, db);
    }

    if (u.pathname === "/api/live/next" && req.method === "POST") {
      const db = await readDb();
      const ros = db.runsOfService.find(x => x.id === db.liveState.rosId);
      if (db.liveState.cueIndex < ros.cues.length - 1) db.liveState.cueIndex++;
      const cue = ros.cues[db.liveState.cueIndex];
      const shot = db.productionShots.find(x => x.id === cue.productionShot);
      db.liveState.programCamera = shot?.preferredCamera || db.liveState.programCamera;
      db.liveState.previewCamera = (shot?.alternates || [])[0] || db.liveState.previewCamera;
      log(db, "Cue advanced", cue.name);
      await writeDb(db);
      return send(res, 200, db);
    }

    if (u.pathname === "/api/live/back" && req.method === "POST") {
      const db = await readDb();
      if (db.liveState.cueIndex > 0) db.liveState.cueIndex--;
      const ros = db.runsOfService.find(x => x.id === db.liveState.rosId);
      log(db, "Cue moved back", ros.cues[db.liveState.cueIndex].name);
      await writeDb(db);
      return send(res, 200, db);
    }

    if (u.pathname === "/api/live/toggle-hold" && req.method === "POST") {
      const db = await readDb();
      db.liveState.paused = !db.liveState.paused;
      log(db, db.liveState.paused ? "Service held" : "Service resumed");
      await writeDb(db);
      return send(res, 200, db);
    }

    if (u.pathname === "/api/live/end" && req.method === "POST") {
      const db = await readDb();
      db.liveState.active = false;
      db.liveState.paused = false;
      log(db, "Service ended");
      await writeDb(db);
      return send(res, 200, db);
    }

    if (u.pathname === "/api/switch" && req.method === "POST") {
      const payload = await body(req);
      const db = await readDb();
      if (["cut","auto"].includes(payload.mode)) {
        const old = db.liveState.programCamera;
        db.liveState.programCamera = db.liveState.previewCamera;
        db.liveState.previewCamera = old;
        log(db, payload.mode.toUpperCase(), db.liveState.programCamera);
        await writeDb(db);
      }
      return send(res, 200, db);
    }

    if (u.pathname === "/api/live/select-camera" && req.method === "POST") {
      const payload = await body(req);
      const db = await readDb();
      const camera = db.devices.find(x => x.id === payload.cameraId && x.type === "camera");
      if (!camera) return send(res, 404, {error:"Camera not found"});
      if (payload.target === "program") db.liveState.programCamera = camera.id;
      else db.liveState.previewCamera = camera.id;
      log(db, `${payload.target === "program" ? "Program" : "Preview"} camera selected`, camera.name);
      await writeDb(db);
      return send(res, 200, db);
    }

    if (u.pathname === "/api/device/toggle" && req.method === "POST") {
      const payload = await body(req);
      const db = await readDb();
      const device = db.devices.find(x => x.id === payload.id);
      if (!device) return send(res, 404, {error:"Device not found"});
      device.status = device.status === "online" ? "offline" : "online";
      log(db, "Device status changed", `${device.name}: ${device.status}`);
      await writeDb(db);
      return send(res, 200, db);
    }

    if (u.pathname === "/api/camera-shots" && req.method === "POST") {
      const payload = await body(req);
      const db = await readDb();
      const item = {
        id:`shot-${Date.now()}`,
        cameraId:payload.cameraId,
        name:String(payload.name || "New Shot"),
        category:String(payload.category || "Custom")
      };
      db.cameraShots.push(item);
      log(db, "Camera preset created", `${item.name} on ${item.cameraId}`);
      await writeDb(db);
      return send(res, 201, db);
    }

    if (u.pathname === "/api/cues" && req.method === "POST") {
      const payload = await body(req);
      const db = await readDb();
      const ros = db.runsOfService.find(x => x.id === (payload.rosId || db.liveState.rosId));
      if (!ros) return send(res, 404, {error:"Run of Service not found"});
      const cue = {
        id:`cue-${Date.now()}`,
        name:String(payload.name || "New Cue"),
        duration:Math.max(0, Number(payload.duration || 300)),
        productionShot:String(payload.productionShot || db.productionShots[0]?.id || ""),
        tracking:Boolean(payload.tracking),
        notes:String(payload.notes || "")
      };
      ros.cues.push(cue);
      log(db, "Cue created", cue.name);
      await writeDb(db);
      return send(res, 201, db);
    }

    let filePath = u.pathname === "/" ? path.join(publicDir, "index.html") : path.join(publicDir, u.pathname);
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, "index.html");
      res.writeHead(200, {"content-type":types[path.extname(filePath)] || "application/octet-stream"});
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404, {"content-type":"text/plain; charset=utf-8"});
      res.end("Not found");
    }
  } catch (error) {
    console.error(error);
    send(res, 500, {error:error.message});
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Trinity Control running at http://127.0.0.1:${port}`));
