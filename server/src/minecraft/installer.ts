import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawn, type SpawnOptions } from "node:child_process";
import { env } from "../config/env.js";

export type ServerType = "vanilla" | "paper" | "fabric" | "forge";
export interface JavaInfo { path: string; major: number; version: string; }
export interface VersionInfo { id: string; type: "release" | "snapshot"; javaMajor: number | null; url: string; }
interface MojangManifest { versions: Array<{id:string;type:"release"|"snapshot";url:string}>; }
interface VersionMeta { id:string; javaVersion?: {majorVersion?:number}; downloads?: {server?: {url:string;sha1?:string;sha256?:string}}; }

const USER_AGENT = "mc-panel/0.1.0 (private Minecraft server panel)";
const HOSTS = new Set([
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
  const u = new URL(raw);
  if (u.protocol !== "https:" || !HOSTS.has(u.hostname)) throw new Error("Untrusted download URL");
  return u;
}

async function response(url: string): Promise<Response> {
  const u = assertSafeUrl(url);
  const r = await fetch(u, { headers: { "User-Agent": USER_AGENT } });
  if (!r.ok) throw new Error("Remote request failed: " + r.status);
  return r;
}

async function json<T>(url:string):Promise<T> {
  return await (await response(url)).json() as T;
}

function verifyChecksum(file: string, expected: string, algorithm: "sha1"|"sha256") {
  const actual = crypto.createHash(algorithm).update(fs.readFileSync(file)).digest("hex");
  if (actual.toLowerCase() !== expected.trim().toLowerCase()) throw new Error(algorithm.toUpperCase() + " checksum mismatch");
}

async function download(url:string, destination:string, checksum?: {algorithm:"sha1"|"sha256";value:string}) {
  assertSafeUrl(url);
  const r = await response(url);
  if (!r.body) throw new Error("Download failed: empty response");
  const tmp = destination + ".part";
  const file = fs.createWriteStream(tmp);
  try {
    for await (const chunk of r.body as AsyncIterable<Uint8Array>) file.write(chunk);
    await new Promise<void>((resolve,reject)=>file.end(err=>err?reject(err):resolve()));
    if (checksum) verifyChecksum(tmp, checksum.value, checksum.algorithm);
    fs.renameSync(tmp, destination);
  } catch (e) {
    file.destroy();
    fs.rmSync(tmp,{force:true});
    throw e;
  }
}

async function sha1Sidecar(url:string):Promise<string> {
  const r = await response(url + ".sha1");
  const text = (await r.text()).trim();
  const match = text.match(/^[a-fA-F0-9]{40}/);
  if (!match) throw new Error("Forge SHA-1 checksum is unavailable");
  return match[0];
}

function assertMinecraftRuntime() {
  if (process.platform === "win32") throw new Error("Minecraft runtime must run on Linux as the minecraft user");
  const current = os.userInfo().username;
  if (current !== env.minecraftUser || process.getuid?.() === 0) {
    throw new Error("Minecraft installer must run as the minecraft user, never root");
  }
  const root = path.resolve(process.env.MINECRAFT_ROOT?.trim() || env.minecraftRoot);
  if (root !== "/srv/minecraft" && process.env.NODE_ENV !== "test") throw new Error("Minecraft root must be /srv/minecraft");
}

export async function getVersionMetadata(version:string):Promise<VersionMeta> {
  const m = await json<MojangManifest>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  const v = m.versions.find(x=>x.id===version);
  if (!v) throw new Error("Minecraft version is not available");
  return json<VersionMeta>(v.url);
}

export async function getVersions(type:ServerType):Promise<VersionInfo[]> {
  const m = await json<MojangManifest>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  const releases = m.versions.filter(x=>x.type==="release");
  if (type==="vanilla") return releases.map(v=>({id:v.id,type:"release",javaMajor:null,url:v.url}));
  if (type==="paper") {
    const p=await json<{versions:Record<string,string[]>>>("https://fill.papermc.io/v3/projects/paper");
    const set=new Set(Object.values(p.versions).flat());
    return releases.filter(v=>set.has(v.id)).map(v=>({id:v.id,type:"release",javaMajor:null,url:""}));
  }
  if (type==="fabric") {
    const f=await json<Array<{version:string;stable:boolean}>>("https://meta.fabricmc.net/v2/versions/game");
    const set=new Set(f.filter(x=>x.stable).map(x=>x.version));
    return releases.filter(v=>set.has(v.id)).map(v=>({id:v.id,type:"release",javaMajor:null,url:""}));
  }
  const maven=await response("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml");
  const xml=await maven.text();
  const set=new Set([...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(x=>x[1].split("-")[0]));
  return releases.filter(v=>set.has(v.id)).map(v=>({id:v.id,type:"release",javaMajor:null,url:""}));
}

async function detectCommand(command:string):Promise<JavaInfo|null>{
  return new Promise(resolve=>{
    const c=spawn(command,["-version"],{shell:false,stdio:["ignore","pipe","pipe"]});
    let out="";
    c.stderr?.on("data",d=>out+=String(d)); c.stdout?.on("data",d=>out+=String(d));
    c.on("error",()=>resolve(null));
    c.on("close",()=>{const m=out.match(/version "([^"]+)"/);if(!m)return resolve(null);const major=m[1].startsWith("1.")?Number(m[1].split(".")[1]):Number(m[1].split(".")[0]);resolve(Number.isInteger(major)?{path:command,major,version:m[1]}:null)});
  });
}

export async function detectJava():Promise<JavaInfo[]>{
  const c=new Set(["java","/usr/bin/java"]);
  if(process.env.JAVA_HOME)c.add(path.join(process.env.JAVA_HOME,"bin","java"));
  for(const d of [17,21,25])c.add("/usr/lib/jvm/java-"+d+"-openjdk-amd64/bin/java");
  const out:JavaInfo[]=[]; for(const x of c){const j=await detectCommand(x);if(j&&!out.some(y=>y.path===j.path))out.push(j)} return out;
}

const runJava=(command:string,args:string[],cwd:string)=>new Promise<void>((resolve,reject)=>{
  const o:SpawnOptions={cwd,shell:false,stdio:["ignore","pipe","pipe"]};
  const c=spawn(command,args,o); let e=""; c.stderr?.on("data",d=>e+=String(d)); c.on("error",reject);
  c.on("close",code=>code===0?resolve():reject(new Error("Java installer failed"+(e?": "+e.slice(-1000):""))));
});

export async function installServer(type:ServerType,version:string,javaCommand="java"):Promise<{javaMajor:number;serverJar:string}>{
  assertMinecraftRuntime();
  const allowedType:ServerType[]=["vanilla","paper","fabric","forge"];
  if(!allowedType.includes(type)) throw new Error("Invalid server type");
  if(!/^[A-Za-z0-9._-]{1,32}$/.test(version)) throw new Error("Invalid Minecraft version");
  const realVersions=await getVersions(type);
  if(!realVersions.some(v=>v.id===version)) throw new Error("Minecraft version is not available for this server type");
  const root=path.resolve(process.env.MINECRAFT_ROOT?.trim()||env.minecraftRoot);
  fs.mkdirSync(root,{recursive:true});
  const meta=await getVersionMetadata(version);
  const javaMajor=meta.javaVersion?.majorVersion??21;
  const jar=path.join(root,"server.jar");

  if(type==="vanilla"){
    const d=meta.downloads?.server; if(!d?.url||!d.sha1) throw new Error("Vanilla server checksum is unavailable");
    await download(d.url,jar,{algorithm:"sha1",value:d.sha1});
  } else if(type==="paper"){
    const builds=await json<Array<{channel:string;downloads?:Record<string,{url:string;checksums?:{sha256?:string}}> }>>(
      "https://fill.papermc.io/v3/projects/paper/versions/"+encodeURIComponent(version)+"/builds"
    );
    const b=builds.find(x=>x.channel==="STABLE"&&x.downloads?.["server:default"]?.checksums?.sha256);
    if(!b) throw new Error("No stable Paper build with SHA-256 checksum is available");
    const d=b.downloads!["server:default"];
    await download(d.url,jar,{algorithm:"sha256",value:d.checksums!.sha256!});
  } else if(type==="fabric"){
    const loaders=await json<Array<{version:string;stable:boolean}>>("https://meta.fabricmc.net/v2/versions/loader/"+encodeURIComponent(version));
    const l=loaders.find(x=>x.stable);
    const installers=await json<Array<{version:string;stable:boolean}>>("https://meta.fabricmc.net/v2/versions/installer");
    const i=installers.find(x=>x.stable);
    if(!l||!i) throw new Error("No stable Fabric loader/installer is available");
    await download("https://meta.fabricmc.net/v2/versions/loader/"+encodeURIComponent(version)+"/"+encodeURIComponent(l.version)+"/"+encodeURIComponent(i.version)+"/server/jar",jar);
  } else {
    const m=await response("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml");
    const xml=await m.text();
    const versions=[...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(x=>x[1]).filter(x=>x.startsWith(version+"-"));
    if(!versions.length) throw new Error("No Forge build is available for this version");
    const fv=versions[versions.length-1];
    const installerUrl="https://maven.minecraftforge.net/net/minecraftforge/forge/"+encodeURIComponent(fv)+"/forge-"+encodeURIComponent(fv)+"-installer.jar";
    const checksum=await sha1Sidecar(installerUrl);
    const installer=path.join(root,"forge-installer.jar");
    await download(installerUrl,installer,{algorithm:"sha1",value:checksum});
    await runJava(javaCommand,["-jar",path.basename(installer),"--installServer",root],root);
    fs.rmSync(installer,{force:true});
    if(!fs.existsSync(path.join(root,"run.sh"))) throw new Error("Forge installer did not produce run.sh");
    fs.writeFileSync(jar,"");
  }
  fs.writeFileSync(path.join(root,"eula.txt"),"eula=false\n");
  return {javaMajor,serverJar:jar};
}
