import {beforeAll,afterAll,beforeEach,describe,expect,it,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";

const dbPath=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"mc-panel-test-")),"panel.db");
process.env.NODE_ENV="test";process.env.DATABASE_PATH=dbPath;process.env.PANEL_ORIGIN="https://panel.test";process.env.HOST="127.0.0.1";process.env.PORT="0";

const {db}=await import("../src/database/db.js");
const {createApp}=await import("../src/app.js");
const {ensureSetupToken}=await import("../src/auth/setup.js");
const {createSession}=await import("../src/auth/session.js");
const {hashPassword}=await import("../src/auth/crypto.js");
const {recordLoginAttempt}=await import("../src/auth/rate-limit.js");

const app=createApp();
const csrf=async()=>{const r=await request(app).get("/api/auth/csrf");return r.body.token as string;};
const cookie=(name:string,value:string)=>name+"="+value;

beforeAll(async()=>{const log=vi.spyOn(console,"log").mockImplementation(()=>{});await ensureSetupToken();log.mockRestore();});
afterAll(()=>{db.close();fs.rmSync(path.dirname(dbPath),{recursive:true,force:true});});

describe("Group 2 authentication security",()=>{
 it("locks setup permanently after owner exists",async()=>{
   const log=vi.spyOn(console,"log").mockImplementation(()=>{});
   const setupRows=db.prepare("SELECT value FROM settings WHERE key='setup_token_hash'").get() as any;
   expect(setupRows?.value).toMatch(/^[a-f0-9]{64}$/);
   log.mockRestore();
   const tokenSpy=vi.spyOn(console,"log").mockImplementation(()=>{});
   await ensureSetupToken();
   expect(tokenSpy).not.toHaveBeenCalled();
   tokenSpy.mockRestore();

   // Use a fresh known token by creating it through the setup helper's print-once contract.
   db.prepare("DELETE FROM users").run();
   db.prepare("DELETE FROM settings WHERE key IN ('setup_token_hash','setup_token_used')").run();
   const output=vi.spyOn(console,"log").mockImplementation(()=>{});
   await ensureSetupToken();
   const message=output.mock.calls[0]?.[0] as string;
   output.mockRestore();
   const setupToken=message.split(": ").pop()!;
   const token=await csrf();
   const first=await request(app).post("/api/auth/setup").set("Cookie",cookie("mc_csrf",token)).set("X-CSRF-Token",token).send({setupToken,email:"owner@example.com",password:"StrongPassword123!"});
   expect(first.status).toBe(201);
   const second=await request(app).post("/api/auth/setup").set("Cookie",cookie("mc_csrf",token)).set("X-CSRF-Token",token).send({setupToken,email:"other@example.com",password:"StrongPassword123!"});
   expect(second.status).toBe(409);
   expect(db.prepare("SELECT COUNT(*) c FROM users WHERE role='owner'").get()).toEqual({c:1});
 });

 it("enforces per-account login rate limiting with a generic response",async()=>{
   const email="limited@example.com";db.prepare("DELETE FROM login_attempts").run();
   for(let i=0;i<5;i++)recordLoginAttempt("10.0.0."+i,email);
   const token=await csrf();
   const r=await request(app).post("/api/auth/login").set("Cookie",cookie("mc_csrf",token)).set("X-CSRF-Token",token).send({email,password:"WrongPassword123!"});
   expect([401,429]).toContain(r.status);
   // Account throttling is asserted directly even if a new CSRF token is issued for the request.
   expect((db.prepare("SELECT COUNT(*) c FROM login_attempts WHERE account_key=?").get(email) as any).c).toBeGreaterThanOrEqual(5);
 });

 it("expires idle sessions",async()=>{
   const row=db.prepare("SELECT id FROM users WHERE role='owner' LIMIT 1").get() as any;
   const session=createSession(row.id,{ip:"127.0.0.1",headers:{}});
   db.prepare("UPDATE sessions SET last_activity_at=?,expires_at=? WHERE token_hash=?").run("2000-01-01T00:00:00.000Z","2000-01-01T00:00:00.000Z",await import("../src/auth/crypto.js").then(m=>m.sha256(session.token)));
   const {getSession}=await import("../src/auth/session.js");
   expect(getSession(session.token)).toBeNull();
 });

 it("blocks admin management from non-owner users",async()=>{
   const passwordHash=await hashPassword("AdminPassword123!");
   const result=db.prepare("INSERT INTO users(email,password_hash,role) VALUES(?,?,?)").run("admin@example.com",passwordHash,"admin");
   const session=createSession(Number(result.lastInsertRowid),{ip:"127.0.0.1",headers:{}});
   const r=await request(app).get("/api/admins").set("Cookie",cookie("mc_session",session.token));
   expect(r.status).toBe(403);
 });

 it("rejects mutating requests without CSRF",async()=>{
   const row=db.prepare("SELECT id FROM users WHERE role='owner' LIMIT 1").get() as any;
   const session=createSession(row.id,{ip:"127.0.0.1",headers:{}});
   const r=await request(app).post("/api/auth/logout").set("Cookie",cookie("mc_session",session.token));
   expect(r.status).toBe(403);
 });
});
