import {describe,expect,it} from "vitest";
import {getVersionMetadata} from "../minecraft/installer.js";
describe("Group 4 installer",()=>{it("rejects an unknown Minecraft version",async()=>{await expect(getVersionMetadata("definitely-not-a-real-version")).rejects.toThrow("Minecraft version is not available")});it("accepts normal Minecraft version syntax",()=>{expect(/^[A-Za-z0-9._-]{1,32}$/.test("1.21.11")).toBe(true)})});
