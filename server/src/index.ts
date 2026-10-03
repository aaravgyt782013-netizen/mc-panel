import "dotenv/config";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env.js";
import { db } from "./database/db.js";
import { mutationOriginCheck } from "./middleware/security.js";
import { attachWebSocket } from "./websocket/index.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(cors({ origin: env.panelOrigin, credentials: true }));
app.use(mutationOriginCheck);
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "mc-panel", database: "ok" }));
const server = http.createServer(app);
attachWebSocket(server);
server.listen(env.port, env.host, () => {
  console.log("MC Panel listening on http://" + env.host + ":" + env.port);
  console.log("Minecraft root: " + env.minecraftRoot);
  console.log("Minecraft runtime user: " + env.minecraftUser);
});
process.on("SIGTERM", () => { db.close(); server.close(() => process.exit(0)); });
