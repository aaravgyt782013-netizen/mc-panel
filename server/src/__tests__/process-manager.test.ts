import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { MinecraftProcessManager } from "../minecraft/process-manager.js";
import { db } from "../database/db.js";

class FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  killed = false;
  commandWrites: string[] = [];
  stdin = {
    writable: true,
    write: (value: string) => {
      this.commandWrites.push(value);
      return true;
    }
  };
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill = (_signal?: string) => {
    this.killed = true;
    this.exitCode = 0;
    this.emit("close", 0, null);
    return true;
  };
}

describe("Minecraft process manager", () => {
  let root: string;
  let children: FakeChild[];

  beforeEach(() => {
    vi.useFakeTimers();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-engine-"));
    children = [];

    fs.writeFileSync(path.join(root, "eula.txt"), "eula=true\n");
    fs.writeFileSync(
      path.join(root, "server.jar"),
      "test placeholder; never executed"
    );
    fs.writeFileSync(
      path.join(root, "fake-java.mjs"),
      [
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', chunk => {",
        "  if (chunk.trim() === 'stop') process.exit(0);",
        "});",
        "setInterval(() => {}, 60_000);"
      ].join("\n")
    );

    process.env.MINECRAFT_ROOT = root;
    db.prepare(
      "UPDATE server_config SET min_ram_mb=512,max_ram_mb=512,aikar_flags=0,crash_restart_enabled=1,max_crash_restarts=2 WHERE id=1"
    ).run();
    db.prepare(
      "UPDATE server_status SET status='offline',pid=NULL,restart_count=0,last_exit_code=NULL,last_crash_at=NULL WHERE id=1"
    ).run();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.MINECRAFT_ROOT;
  });

  it("starts with configured JVM arguments, writes commands, and stops intentionally", async () => {
    let spawnCommand = "";
    let spawnArgs: string[] = [];
    const fakeJavaScript = path.join(root, "fake-java.mjs");

    const manager = new MinecraftProcessManager({
      spawnFn: ((_command, args) => {
        spawnCommand = _command;
        spawnArgs = [...args];
        expect(fakeJavaScript).toMatch(/fake-java\.mjs$/);
        const child = new FakeChild(1234);
        children.push(child);
        return child as any;
      }) as any,
      restartDelayMs: 0
    });

    const started = await manager.start();

    expect(started.status).toBe("running");
    expect(children).toHaveLength(1);
    expect(spawnCommand).toBe("java");
    expect(spawnArgs).toEqual([
      "-Xms512M",
      "-Xmx512M",
      "-jar",
      "server.jar",
      "--nogui"
    ]);

    manager.sendCommand("say hello");
    expect(children[0].commandWrites).toEqual(["say hello\n"]);

    await manager.stop();
    expect(manager.status().status).toBe("stopping");
    expect(children[0].commandWrites).toEqual(["say hello\n", "stop\n"]);

    children[0].emit("close", 0, null);
    expect(manager.status().status).toBe("offline");

    vi.advanceTimersByTime(10_000);
    expect(children).toHaveLength(1);
  });

  it("enforces the crash-loop restart limit without real sleeps", async () => {
    const manager = new MinecraftProcessManager({
      spawnFn: ((_command, _args, _options) => {
        const child = new FakeChild(2000 + children.length);
        children.push(child);
        return child as any;
      }) as any,
      restartDelayMs: 25,
      stableRunMs: 60_000
    });

    await manager.start();

    children[0].emit("close", 1, null);
    expect(manager.status().status).toBe("crashed");
    expect(children).toHaveLength(1);

    vi.advanceTimersByTime(25);
    await Promise.resolve();
    expect(children).toHaveLength(2);

    children[1].emit("close", 1, null);
    expect(manager.status().status).toBe("crashed");

    vi.advanceTimersByTime(25);
    await Promise.resolve();
    expect(children).toHaveLength(3);

    children[2].emit("close", 1, null);
    expect(manager.status().status).toBe("crash-loop");

    vi.advanceTimersByTime(1_000);
    expect(children).toHaveLength(3);
  });
});
