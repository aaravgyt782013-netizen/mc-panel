import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { requireOwner } from "../auth/middleware.js";
import { assertModrinthDownloadUrl, downloadAndVerifyModrinth, validateJarName, validateModrinthId } from "../routes/plugins.js";

describe("Group 7 plugins/mods security", () => {
  let root: string;
  beforeEach(()=>{ root=fs.mkdtempSync(path.join(os.tmpdir(),"mc-plugins-")); process.env.MINECRAFT_ROOT=root; });
  afterEach(()=>{ delete process.env.MINECRAFT_ROOT; fs.rmSync(root,{recursive:true,force:true}); vi.restoreAllMocks(); });
  it("rejects unsafe JAR filenames",()=>{ expect(()=>validateJarName("../evil.jar")).toThrow(); expect(()=>validateJarName("x/y.jar")).toThrow(); expect(()=>validateJarName("bad.jar.disabled")).toThrow(); expect(()=>validateJarName("ok.jar")).not.toThrow(); });
  it("rejects unsafe Modrinth project/version IDs",()=>{ expect(()=>validateModrinthId("../x")).toThrow(); expect(()=>validateModrinthId("short")).toThrow(); expect(validateModrinthId("Ab12Cd34")).toBe("Ab12Cd34"); });
  it("allows only official HTTPS Modrinth download hosts",()=>{ expect(()=>assertModrinthDownloadUrl("http://cdn.modrinth.com/data/x.jar")).toThrow(); expect(()=>assertModrinthDownloadUrl("https://evil.example/x.jar")).toThrow(); expect(assertModrinthDownloadUrl("https://cdn.modrinth.com/data/abcd/versions/v/test.jar").hostname).toBe("cdn.modrinth.com"); });
  it("rejects Modrinth SHA-512 mismatch",async()=>{ const body=Buffer.from("plugin"); const hash=crypto.createHash("sha512").update(body).digest("hex"); const fake=vi.fn<typeof fetch>(async()=>new Response(body,{status:200,headers:{"content-length":String(body.length)}})); await expect(downloadAndVerifyModrinth("https://cdn.modrinth.com/data/a/versions/b/test.jar",hash.slice(0,-1)+"0",body.length,fake)).rejects.toThrow("SHA-512 mismatch"); });
  it("accepts correctly hashed downloads and rejects oversized downloads",async()=>{ const body=Buffer.from("plugin"); const hash=crypto.createHash("sha512").update(body).digest("hex"); const fake=vi.fn<typeof fetch>(async()=>new Response(body,{status:200,headers:{"content-length":String(body.length)}})); await expect(downloadAndVerifyModrinth("https://cdn.modrinth.com/data/a/versions/b/test.jar",hash,body.length,fake)).resolves.toEqual(body); const tooLarge=vi.fn<typeof fetch>(async()=>new Response(Buffer.alloc(10*1024*1024+1),{status:200})); await expect(downloadAndVerifyModrinth("https://cdn.modrinth.com/data/a/versions/b/test.jar",hash,10*1024*1024+1,tooLarge)).rejects.toThrow("exceeds size limit"); });
  it("enforces owner-only mutations through requireOwner",()=>{ const req={authUser:{id:1,email:"admin@example.com",role:"admin"}} as any; const res={status:vi.fn().mockReturnThis(),json:vi.fn()}; const next=vi.fn(); requireOwner(req,res as any,next); expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled(); const ownerReq={authUser:{id:1,email:"owner@example.com",role:"owner"}} as any; const ownerNext=vi.fn(); requireOwner(ownerReq,res as any,ownerNext); expect(ownerNext).toHaveBeenCalled(); });
});