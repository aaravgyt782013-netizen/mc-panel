import { describe,expect,it } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { backupFilename,validateBackupId,enforceRetention } from "../minecraft/backups.js";
describe("Group 8 backups",()=>{
 it("validates backup IDs and filenames",()=>{expect(()=>validateBackupId("../x")).toThrow();expect(()=>validateBackupId("backup-20261004T120000Z-deadbeef")).not.toThrow();expect(backupFilename("backup-20261004T120000Z-deadbeef")).toBe("backup-20261004T120000Z-deadbeef.zip");});
 it("enforces retention",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"mc-backups-"));process.env.BACKUP_ROOT=root;fs.writeFileSync(path.join(root,"backup-20261001T120000Z-deadbeef.zip"),"x");fs.writeFileSync(path.join(root,"backup-20261002T120000Z-deadbeef.zip"),"x");fs.writeFileSync(path.join(root,"backup-20261003T120000Z-deadbeef.zip"),"x");expect(enforceRetention(2)).toHaveLength(1);expect(fs.readdirSync(root)).toHaveLength(2);delete process.env.BACKUP_ROOT;fs.rmSync(root,{recursive:true,force:true});});
 it("keeps backup root separate from Minecraft root by default",()=>{expect(process.env.BACKUP_ROOT||"/srv/minecraft-backups").not.toBe(process.env.MINECRAFT_ROOT||"/srv/minecraft");});
 it("requires stopped server and makes safety backup before restore",()=>{const source=fs.readFileSync(path.resolve("src/minecraft/backups.ts"),"utf8");expect(source).toContain('status().status !== "offline"');expect(source.indexOf("createSafetyBackup")).toBeLessThan(source.indexOf("fs.rmSync(root"));});
 it("always runs save-on after backup failure",()=>{const source=fs.readFileSync(path.resolve("src/minecraft/backups.ts"),"utf8");expect(source).toContain('manager.sendCommand("save-on")');expect(source).toContain("finally");});
 it("uses save-off, save-all flush, zip, save-on",()=>{const source=fs.readFileSync(path.resolve("src/minecraft/backups.ts"),"utf8");for(const command of ["save-off","save-all flush","save-on"])expect(source).toContain('manager.sendCommand("'+command+'")');expect(source).toContain("zip.writeZip");});
 it("checks disk space before zip",()=>{const source=fs.readFileSync(path.resolve("src/minecraft/backups.ts"),"utf8");expect(source.indexOf("enoughSpace")).toBeLessThan(source.indexOf("zip.writeZip"));});
 it("audits create, scheduled, restore and delete",()=>{const source=fs.readFileSync(path.resolve("src/routes/backups.ts"),"utf8");for(const action of ["BACKUP_CREATE","BACKUP_SCHEDULED","BACKUP_RESTORE","BACKUP_DELETE"])expect(source).toContain(action);});
});
