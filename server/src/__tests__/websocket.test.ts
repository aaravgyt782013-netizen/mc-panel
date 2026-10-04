import { describe,expect,it,vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import type { MinecraftProcessManager } from "../minecraft/process-manager.js";

process.env.PANEL_ORIGIN="https://panel.test";
process.env.SESSION_SECRET="websocket-test-session-secret-32-bytes-minimum";

const { attachWebSocket }=await import("../websocket/index.js");

function harness(){
  const server=new EventEmitter() as unknown as Server;
  const manager={status:vi.fn(()=>({status:"offline",pid:null,startedAt:null,stoppedAt:null,lastExitCode:null,lastCrashAt:null,restartCount:0}))} as unknown as MinecraftProcessManager;
  attachWebSocket(server,manager);
  const handler=(server as unknown as EventEmitter).listeners("upgrade")[0] as (request:{headers:Record<string,string|undefined>;url:string},socket:{write:ReturnType<typeof vi.fn>;destroy:ReturnType<typeof vi.fn>},head:Buffer)=>void;
  const socket={write:vi.fn(),destroy:vi.fn()};
  return {handler,socket};
}

describe("WebSocket security",()=>{
  it("rejects a non-panel Origin before authentication",()=>{
    const {handler,socket}=harness();
    handler({headers:{origin:"https://evil.example"},url:"/ws"},socket,Buffer.alloc(0));
    expect(socket.write).toHaveBeenCalledWith("HTTP/1.1 403 Forbidden\r\n\r\n");
    expect(socket.destroy).toHaveBeenCalled();
  });
  it("rejects a missing or invalid session even with the correct Origin",()=>{
    const {handler,socket}=harness();
    handler({headers:{origin:"https://panel.test"},url:"/ws"},socket,Buffer.alloc(0));
    expect(socket.write).toHaveBeenCalledWith("HTTP/1.1 401 Unauthorized\r\n\r\n");
    expect(socket.destroy).toHaveBeenCalled();
  });
});
