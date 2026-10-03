import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawn, type SpawnOptions } from "node:child_process";
import { env } from "../config/env.js";

export type ServerType = "vanilla" | "paper" | "fabric" | "forge";
export interface JavaInfo { path: string; major: number; version: string; }
export interface VersionInfo { id: string; type: "release" | "snapshot"; javaMajor: number | null; url: string; }
interface MojangManifest { versions: Array<{ id: string; type: "release" | "snapshot"; url: string }>; }
interface VersionMeta {
  id: string;
  javaVersion?: { majorVersion?: number };
  downloads?: { server?: { url: string; sha1?: string; sha256?: string } };
}

const USER_AGENT = "mc-panel/0.1.0 (private Minecraft server panel)";
const OFFICIAL_HOSTS = new Set([
  "piston-meta.mojang.com",
  "libraries.minecraft.net",
  "fill.papermc.io",
  "fill-data.papermc.io",
  "meta.fabricmc.net",
  "maven.fabricmc.net",
  "maven.minecraftforge.net",
  "files.minecraftforge.net"
]);

function assertSafeUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !OFFICIAL_HOSTS.has(url.hostname)) {
    throw new Error("Untrusted HTTPS download URL");
  }
  return url;
}

async function response(rawUrl: string): Promise<Response> {
  const url = assertSafeUrl(rawUrl);
  const result = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!result.ok) throw new Error("Remote request failed: " + result.status);
  return result;
}

async function json<T>(rawUrl: string): Promise<T> {
  return await response(rawUrl).then(r => r.json() as Promise<T>);
}

function verifyChecksum(filePath: string, expected: string, algorithm: "sha1" | "sha256"): void {
  const actual = crypto.createHash(algorithm).update(fs.readFileSync(filePath)).digest("hex");
  if (actual.toLowerCase() !== expected.trim().toLowerCase()) {
    throw new Error(algorithm.toUpperCase() + " checksum mismatch");
  }
}

async function download(
  rawUrl: string,
  destination: string,
  checksum?: { algorithm: "sha1" | "sha256"; value: string }
): Promise<void> {
  const url = assertSafeUrl(rawUrl);
  const result = await response(url.toString());
  if (!result.body) throw new Error("Download failed: empty response");

  const temporary = destination + ".part";
  const file = fs.createWriteStream(temporary);
  try {
    for await (const chunk of result.body as AsyncIterable<Uint8Array>) file.write(chunk);
    await new Promise<void>((resolve, reject) => file.end(error => error ? reject(error) : resolve()));
    if (checksum) verifyChecksum(temporary, checksum.value, checksum.algorithm);
    fs.renameSync(temporary, destination);
  } catch (error) {
    file.destroy();
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

async function forgeSha1(installerUrl: string): Promise<string> {
  const result = await response(installerUrl + ".sha1");
  const text = (await result.text()).trim();
  const match = text.match(/^[a-fA-F0-9]{40}/);
  if (!match) throw new Error("Forge SHA-1 checksum is unavailable");
  return match[0];
}

function assertMinecraftRuntime(): void {
  if (process.env.NODE_ENV === "test") return;
  if (process.platform === "win32") {
    throw new Error("Minecraft runtime must run on Linux as the minecraft user");
  }
  const username = os.userInfo().username;
  if (username !== env.minecraftUser || process.getuid?.() === 0) {
    throw new Error("Minecraft installer must run as the minecraft user, never root");
  }
  const root = path.resolve(process.env.MINECRAFT_ROOT?.trim() || env.minecraftRoot);
  if (root !== "/srv/minecraft") throw new Error("Minecraft root must be /srv/minecraft");
}

export async function getVersionMetadata(version: string): Promise<VersionMeta> {
  const manifest = await json<MojangManifest>(
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
  );
  const versionEntry = manifest.versions.find(item => item.id === version);
  if (!versionEntry) throw new Error("Minecraft version is not available");
  return json<VersionMeta>(versionEntry.url);
}

export async function getVersions(type: ServerType): Promise<VersionInfo[]> {
  const manifest = await json<MojangManifest>(
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
  );
  const releases = manifest.versions.filter(item => item.type === "release");

  if (type === "vanilla") {
    return releases.map(item => ({ id: item.id, type: "release", javaMajor: null, url: item.url }));
  }

  if (type === "paper") {
    const paper = await json<{ versions: Record<string, string[]> }>(
      "https://fill.papermc.io/v3/projects/paper"
    );
    const available = new Set(Object.values(paper.versions).flat());
    return releases
      .filter(item => available.has(item.id))
      .map(item => ({ id: item.id, type: "release", javaMajor: null, url: "" }));
  }

  if (type === "fabric") {
    const fabric = await json<Array<{ version: string; stable: boolean }>>(
      "https://meta.fabricmc.net/v2/versions/game"
    );
    const available = new Set(fabric.filter(item => item.stable).map(item => item.version));
    return releases
      .filter(item => available.has(item.id))
      .map(item => ({ id: item.id, type: "release", javaMajor: null, url: "" }));
  }

  const metadata = await response(
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"
  );
  const xml = await metadata.text();
  const available = new Set(
    [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(match => match[1].split("-")[0])
  );
  return releases
    .filter(item => available.has(item.id))
    .map(item => ({ id: item.id, type: "release", javaMajor: null, url: "" }));
}

async function detectCommand(command: string): Promise<JavaInfo | null> {
  return new Promise(resolve => {
    const child = spawn(command, ["-version"], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", data => { output += String(data); });
    child.stderr?.on("data", data => { output += String(data); });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const match = output.match(/version "([^"]+)"/);
      if (!match) return resolve(null);
      const version = match[1];
      const major = version.startsWith("1.")
        ? Number(version.split(".")[1])
        : Number(version.split(".")[0]);
      resolve(Number.isInteger(major) ? { path: command, major, version } : null);
    });
  });
}

export async function detectJava(): Promise<JavaInfo[]> {
  const commands = new Set(["java", "/usr/bin/java"]);
  if (process.env.JAVA_HOME) commands.add(path.join(process.env.JAVA_HOME, "bin", "java"));
  for (const major of [17, 21, 25]) {
    commands.add("/usr/lib/jvm/java-" + major + "-openjdk-amd64/bin/java");
  }

  const detected: JavaInfo[] = [];
  for (const command of commands) {
    const java = await detectCommand(command);
    if (java && !detected.some(item => item.path === java.path)) detected.push(java);
  }
  return detected;
}

const runJava = (command: string, args: string[], cwd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const options: SpawnOptions = {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    };
    const child = spawn(command, args, options);
    let errorOutput = "";
    child.stderr?.on("data", data => { errorOutput += String(data); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error("Java installer failed" + (errorOutput ? ": " + errorOutput.slice(-1000) : "")));
    });
  });

export async function installServer(
  type: ServerType,
  version: string,
  javaCommand = "java"
): Promise<{ javaMajor: number; serverJar: string }> {
  assertMinecraftRuntime();

  const allowedTypes: ServerType[] = ["vanilla", "paper", "fabric", "forge"];
  if (!allowedTypes.includes(type)) throw new Error("Invalid server type");
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(version)) throw new Error("Invalid Minecraft version");

  const realVersions = await getVersions(type);
  if (!realVersions.some(item => item.id === version)) {
    throw new Error("Minecraft version is not available for this server type");
  }

  const root = path.resolve(process.env.MINECRAFT_ROOT?.trim() || env.minecraftRoot);
  fs.mkdirSync(root, { recursive: true });

  const metadata = await getVersionMetadata(version);
  const javaMajor = metadata.javaVersion?.majorVersion ?? 21;
  const serverJar = path.join(root, "server.jar");

  if (type === "vanilla") {
    const downloadInfo = metadata.downloads?.server;
    if (!downloadInfo?.url || !downloadInfo.sha1) {
      throw new Error("Vanilla server checksum is unavailable");
    }
    await download(serverJar === "" ? downloadInfo.url : downloadInfo.url, serverJar, {
      algorithm: "sha1",
      value: downloadInfo.sha1
    });
  } else if (type === "paper") {
    const builds = await json<Array<{
      channel: string;
      downloads?: Record<string, { url: string; checksums?: { sha256?: string } }>;
    }>>(
      "https://fill.papermc.io/v3/projects/paper/versions/" + encodeURIComponent(version) + "/builds"
    );
    const stable = builds.find(
      build => build.channel === "STABLE" &&
        Boolean(build.downloads?.["server:default"]?.checksums?.sha256)
    );
    const downloadInfo = stable?.downloads?.["server:default"];
    if (!downloadInfo?.checksums?.sha256) {
      throw new Error("No stable Paper build with SHA-256 checksum is available");
    }
    await download(serverJar === "" ? downloadInfo.url : downloadInfo.url, serverJar, {
      algorithm: "sha256",
      value: downloadInfo.checksums.sha256
    });
  } else if (type === "fabric") {
    const loaders = await json<Array<{ version: string; stable: boolean }>>(
      "https://meta.fabricmc.net/v2/versions/loader/" + encodeURIComponent(version)
    );
    const loader = loaders.find(item => item.stable);
    const installers = await json<Array<{ version: string; stable: boolean }>>(
      "https://meta.fabricmc.net/v2/versions/installer"
    );
    const installer = installers.find(item => item.stable);
    if (!loader || !installer) throw new Error("No stable Fabric loader/installer is available");

    await download(
      "https://meta.fabricmc.net/v2/versions/loader/" +
        encodeURIComponent(version) + "/" +
        encodeURIComponent(loader.version) + "/" +
        encodeURIComponent(installer.version) + "/server/jar",
      serverJar
    );
  } else {
    const metadataResponse = await response(
      "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"
    );
    const xml = await metadataResponse.text();
    const forgeVersions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
      .map(match => match[1])
      .filter(item => item.startsWith(version + "-"));

    if (!forgeVersions.length) throw new Error("No Forge build is available for this version");

    const forgeVersion = forgeVersions[forgeVersions.length - 1];
    const installerUrl =
      "https://maven.minecraftforge.net/net/minecraftforge/forge/" +
      encodeURIComponent(forgeVersion) + "/forge-" +
      encodeURIComponent(forgeVersion) + "-installer.jar";
    const checksum = await forgeSha1(installerUrl);
    const installerPath = path.join(root, "forge-installer.jar");

    await download(installerUrl, installerPath, { algorithm: "sha1", value: checksum });
    await runJava(javaCommand, ["-jar", path.basename(installerPath), "--installServer", root], root);
    fs.rmSync(installerPath, { force: true });

    if (!fs.existsSync(path.join(root, "run.sh"))) {
      throw new Error("Forge installer did not produce run.sh");
    }
    fs.writeFileSync(serverJar, "");
  }

  fs.writeFileSync(path.join(root, "eula.txt"), "eula=false\n");
  return { javaMajor, serverJar };
}
