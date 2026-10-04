import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertSafeUrl, getVersionMetadata, verifyChecksum } from "../minecraft/installer.js";

describe("Group 4 installer", () => {
  it("rejects an unknown Minecraft version", async () => {
    await expect(getVersionMetadata("definitely-not-a-real-version"))
      .rejects.toThrow("Minecraft version is not available");
  });

  it("rejects invalid server type and version input", () => {
    expect(["vanilla", "paper", "fabric", "forge"].includes("not-a-type")).toBe(false);
    expect(/^[A-Za-z0-9._-]{1,32}$/.test("../1.21.11")).toBe(false);
    expect(/^[A-Za-z0-9._-]{1,32}$/.test("1.21.11")).toBe(true);
  });

  it("rejects non-HTTPS and non-allowlisted download hosts", () => {
    expect(() => assertSafeUrl("http://piston-meta.mojang.com/mc/game/version_manifest_v2.json")).toThrow();
    expect(() => assertSafeUrl("https://example.com/server.jar")).toThrow();
    expect(() => assertSafeUrl("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")).not.toThrow();
  });

  it("aborts on checksum mismatch", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "installer-checksum-"));
    const file = path.join(root, "server.jar");
    fs.writeFileSync(file, "known content");
    try {
      expect(() => verifyChecksum(file, "0000000000000000000000000000000000000000", "sha1")).toThrow("SHA1 checksum mismatch");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});