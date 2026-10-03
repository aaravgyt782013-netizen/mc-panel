import { WebSocketServer } from "ws";
import type { Server } from "node:http";
import { env } from "../config/env.js";

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (request.headers.origin !== env.panelOrigin) { socket.write("HTTP/1.1 403 Forbidden\\r\\n\\r\\n"); socket.destroy(); return; }
    if (request.url !== "/ws") { socket.write("HTTP/1.1 404 Not Found\\r\\n\\r\\n"); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => ws.send(JSON.stringify({ type: "connection:ready" })));
  });
  return wss;
}
