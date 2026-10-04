import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { MAX_UPLOAD_BYTES, extractZipSafely, resolveSandboxPath } from "../routes/files.js";

describe("Group 6 file sandbox", () => {
  let root: string;
  let outside: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-files-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "mc-outside-"));
    process.env.MINECRAFT_ROOT = root;
  });
  afterEach(() => {
    delete process.env.MINECRAFT_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  function zipWithEntryName(name: string, content = "blocked"): Buffer {
    const zip = new AdmZip();
    const entry = zip.addFile("placeholder.txt", Buffer.from(content));
    entry.entryName = name;
    return zip.toBuffer();
  }

  it("rejects ../ traversal", () => {
    expect(() => resolveSandboxPath("../outside")).toThrow("Path traversal is not allowed");
    expect(() => resolveSandboxPath("folder/../../outside")).toThrow("Path traversal is not allowed");
  });

  it("rejects absolute paths", () => {
    expect(() => resolveSandboxPath("/etc/passwd")).toThrow("Absolute paths are not allowed");
  });

  it("rejects symlink escape", () => {
    fs.symlinkSync(outside, path.join(root, "escape"), "dir");
    expect(() => resolveSandboxPath("escape/secret.txt")).toThrow("Symlinks are not allowed");
  });

  it("rejects oversized uploads before extraction", () => {
    expect(() => extractZipSafely(Buffer.alloc(MAX_UPLOAD_BYTES + 1), "")).toThrow("Upload exceeds size limit");
  });

  it("rejects ZIP traversal entries", () => {
    expect(() => extractZipSafely(zipWithEntryName("../outside.txt"), "")).toThrow("ZIP contains an unsafe path");
  });

  it("rejects ZIP absolute entries", () => {
    expect(() => extractZipSafely(zipWithEntryName("/outside.txt"), "")).toThrow("ZIP contains an absolute path");
  });

  it("extracts a valid archive", () => {
    const zip = new AdmZip();
    zip.addFile("folder/hello.txt", Buffer.from("hello"));
    const bytes = extractZipSafely(zip.toBuffer(), "");
    expect(bytes).toBe(5);
    expect(fs.readFileSync(path.join(root, "folder", "hello.txt"), "utf8")).toBe("hello");
  });

  it("writes nothing when any archive entry is unsafe", () => {
    const zip = new AdmZip();
    zip.addFile("safe.txt", Buffer.from("safe"));
    const unsafe = zip.addFile("placeholder.txt", Buffer.from("blocked"));
    unsafe.entryName = "../outside.txt";
    expect(() => extractZipSafely(zip.toBuffer(), "")).toThrow("ZIP contains an unsafe path");
    expect(fs.existsSync(path.join(root, "safe.txt"))).toBe(false);
    expect(fs.existsSync(path.join(root, "outside.txt"))).toBe(false);
  });
});
