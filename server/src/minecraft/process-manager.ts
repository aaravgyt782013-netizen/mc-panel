import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { env } from "../config/env.js";
import { db } from "../database/db.js";

export type MinecraftStatus = "offline" | "starting" | "running" | "stopping" | "crashed" | "crash-loop";
export interface MinecraftStatusSnapshot { status: MinecraftStatus; pid: number | null; startedAt: string | null; stoppedAt: string | null; lastExitCode: number | null; lastCrashAt: string | null; restartCount: number; }
type SpawnFn = typeof spawn;

export class MinecraftProcessManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private intentionalStop = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private readonly spawnFn: SpawnFn;
  private readonly now: () => number;
  private readonly restartDelayMs: number;
  private readonly stableRunMs: number;
  private runStartedAt = 0;

  constructor(options: { spawnFn?: SpawnFn; now?: () => number; restartDelayMs?: number; stableRunMs?: number } = {}) {
    super(); this.spawnFn = options.spawnFn ?? spawn; this.now = options.now ?? Date.now;
    this.restartDelayMs = options.restartDelayMs ?? 1500; this.stableRunMs = options.stableRunMs ?? 10 * 60_000;
  }

  status(): MinecraftStatusSnapshot {
    const row = db.prepare("SELECT status,pid,started_at,stopped_at,last_exit_code,last_crash_at,restart_count FROM server_status WHERE id=1").get() as any;
    const alive = !!this.child && this.child.exitCode === null && !this.child.killed;
    return { status: alive ? (row?.status === "stopping" ? "stopping" : "running") : ((row?.status ?? "offline") as MinecraftStatus), pid: alive ? (this.child?.pid ?? null) : null, startedAt: row?.started_at ?? null, stoppedAt: row?.stopped_at ?? null, lastExitCode: row?.last_exit_code ?? null, lastCrashAt: row?.last_crash_at ?? null, restartCount: Number(row?.restart_count ?? 0) };
  }

  async start(): Promise<MinecraftStatusSnapshot> {
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.status();
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    const configuredRoot = process.env.MINECRAFT_ROOT?.trim() || env.minecraftRoot;
    const root = path.resolve(configuredRoot);
    if (process.platform === "win32" || os.userInfo().username !== env.minecraftUser || process.getuid?.() === 0) throw new Error("Minecraft runtime must run as the minecraft user, never root");
    if (root !== "/srv/minecraft" && process.env.NODE_ENV !== "test") throw new Error("Minecraft root must be /srv/minecraft");
    fs.mkdirSync(root, { recursive: true });
    const eulaPath = path.join(root, "eula.txt");
    if (!fs.existsSync(eulaPath) || !/^eula\s*=\s*true\s*$/im.test(fs.readFileSync(eulaPath, "utf8"))) throw new Error("Minecraft EULA has not been accepted");
    const serverType = String((db.prepare("SELECT server_type FROM server_config WHERE id=1").get() as any)?.server_type ?? "vanilla");
    if (serverType === "forge") { if (!fs.existsSync(path.join(root, "run.sh"))) throw new Error("Forge server is not installed"); }
    else if (!fs.existsSync(path.join(root, "server.jar"))) throw new Error("Minecraft server.jar is not installed");
    const config = db.prepare("SELECT min_ram_mb,max_ram_mb,aikar_flags FROM server_config WHERE id=1").get() as any;
    const minRam = Math.max(512, Number(config?.min_ram_mb ?? 1024)); const maxRam = Math.min(env.maxRamMb, Number(config?.max_ram_mb ?? env.maxRamMb));
    if (minRam > maxRam) throw new Error("Minecraft RAM configuration is invalid");
    const args = ["-Xms" + minRam + "M", "-Xmx" + maxRam + "M"];
    if (Number(config?.aikar_flags ?? 1) === 1) args.push("-XX:+UseG1GC","-XX:+ParallelRefProcEnabled","-XX:MaxGCPauseMillis=200","-XX:+UnlockExperimentalVMOptions","-XX:+DisableExplicitGC","-XX:+AlwaysPreTouch","-XX:G1NewSizePercent=30","-XX:G1MaxNewSizePercent=40","-XX:G1HeapRegionSize=8M","-XX:G1ReservePercent=20","-XX:G1HeapWastePercent=5","-XX:G1MixedGCCountTarget=4","-XX:InitiatingHeapOccupancyPercent=15","-XX:G1MixedGCLiveThresholdPercent=90","-XX:G1RSetUpdatingPauseTimePercent=5","-XX:SurvivorRatio=32","-XX:+PerfDisableSharedMem","-XX:MaxTenuringThreshold=1","-Dusing.aikars.flags=https://mcflags.emc.gs","-Daikars.new.flags=true");
    if (serverType === "forge") {
      const runScript = fs.readFileSync(path.join(root, "run.sh"), "utf8");
      const argFiles = runScript.split(/\s+/).filter(x => x.startsWith("@") && x.endsWith(".txt")).map(x => x.slice(1)).filter(x => x === "user_jvm_args.txt" || x.startsWith("libraries/"));
      if (!argFiles.some(x => x.startsWith("libraries/"))) throw new Error("Forge launch arguments are missing");
      args.push(...argFiles.map(x => "@" + x), "nogui");
    } else args.push("-jar","server.jar","--nogui");
    this.intentionalStop = false; this.updateStatus("starting", process.pid, null, null);
    const runtime = os.userInfo();
    const child = this.spawnFn("java", args, { cwd: root, env: { ...process.env }, stdio: ["pipe","pipe","pipe"], shell: false, uid: runtime.uid, gid: runtime.gid });
    this.child = child; this.runStartedAt = this.now(); this.updateStatus("running", child.pid ?? null, new Date(this.now()).toISOString(), null); this.emit("status", this.status());
    child.stdout?.on("data", data => this.emit("console", { stream: "stdout", data: String(data) }));
    child.stderr?.on("data", data => this.emit("console", { stream: "stderr", data: String(data) }));
    child.on("error", error => this.emit("console", { stream: "stderr", data: String(error.message) }));
    child.on("close", (code, signal) => this.handleClose(child, code, signal));
    return this.status();
  }

  async stop(): Promise<MinecraftStatusSnapshot> {
    if (!this.child || this.child.exitCode !== null || this.child.killed) return this.status();
    this.intentionalStop = true; this.updateStatus("stopping", this.child.pid ?? null, null, null); this.child.stdin?.write("stop\n");
    setTimeout(() => { if (this.child && this.child.exitCode === null) this.child.kill("SIGTERM"); }, 10_000).unref();
    return this.status();
  }

  async restart(): Promise<MinecraftStatusSnapshot> {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      this.intentionalStop = true; this.updateStatus("stopping", this.child.pid ?? null, null, null); this.child.stdin?.write("stop\n");
      await new Promise<void>(resolve => { const current = this.child; const onClose = () => { current?.removeListener("close", onClose); resolve(); }; current?.once("close", onClose); setTimeout(() => { if (current && current.exitCode === null) current.kill("SIGTERM"); }, 10_000).unref(); });
    }
    this.intentionalStop = false; return this.start();
  }

  async kill(): Promise<MinecraftStatusSnapshot> {
    if (!this.child || this.child.exitCode !== null || this.child.killed) return this.status();
    this.intentionalStop = true; this.updateStatus("stopping", this.child.pid ?? null, null, null); this.child.kill("SIGKILL"); return this.status();
  }

  sendCommand(command: string) {
    const value = command.trim();
    if (!value || value.length > 2048 || /[\r\n]/.test(value)) throw new Error("Invalid console command");
    if (!this.child || this.child.exitCode !== null || this.child.killed || !this.child.stdin?.writable) throw new Error("Minecraft server is not running");
    this.child.stdin.write(value + "\n"); this.emit("console", { stream: "command", data: value + "\n" });
  }

  private handleClose(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null) {
    if (this.child !== child) return; this.child = null; const stoppedAt = new Date(this.now()).toISOString();
    const wasIntentional = this.intentionalStop; this.intentionalStop = false;
    if (wasIntentional) { this.updateStatus("offline", null, null, stoppedAt, code); this.emit("status", this.status()); return; }
    const config = db.prepare("SELECT crash_restart_enabled,max_crash_restarts FROM server_config WHERE id=1").get() as any;
    const current = this.status(); const restartCount = current.restartCount + 1; const canRestart = Number(config?.crash_restart_enabled ?? 1) === 1 && restartCount <= Number(config?.max_crash_restarts ?? 3);
    this.updateStatus(canRestart ? "crashed" : "crash-loop", null, null, stoppedAt, code, stoppedAt, restartCount);
    this.emit("console", { stream: "system", data: "Minecraft exited (code=" + (code ?? "null") + ", signal=" + (signal ?? "none") + ")\n" }); this.emit("status", this.status());
    if (this.runStartedAt && this.now() - this.runStartedAt >= this.stableRunMs) db.prepare("UPDATE server_status SET restart_count=0 WHERE id=1").run();
    if (canRestart) { this.restartTimer = setTimeout(() => { this.restartTimer = null; void this.start().catch(error => this.emit("console", { stream: "system", data: "Auto-restart failed: " + (error instanceof Error ? error.message : String(error)) + "\n" })); }, this.restartDelayMs); this.restartTimer.unref(); }
  }

  private updateStatus(status: MinecraftStatus, pid: number | null, startedAt: string | null, stoppedAt: string | null, exitCode: number | null = null, lastCrashAt: string | null = null, restartCount?: number) {
    const current = db.prepare("SELECT restart_count FROM server_status WHERE id=1").get() as any;
    db.prepare("UPDATE server_status SET status=?,pid=?,started_at=COALESCE(?,started_at),stopped_at=COALESCE(?,stopped_at),last_exit_code=?,last_crash_at=COALESCE(?,last_crash_at),restart_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").run(status,pid,startedAt,stoppedAt,exitCode,lastCrashAt,restartCount ?? Number(current?.restart_count ?? 0));
  }
}