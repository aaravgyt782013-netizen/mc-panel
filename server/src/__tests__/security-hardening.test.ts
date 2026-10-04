import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createGlobalApiRateLimiter } from "../middleware/security.js";
import { operationalError } from "../middleware/errors.js";

describe("security hardening", () => {
  it("rate-limits the API by IP", async () => {
    const app = express();
    app.use(createGlobalApiRateLimiter(2));
    app.get("/", (_req, res) => res.json({ ok: true }));
    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(429);
  });

  it("returns a generic operational error and logs the detail server-side", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = express();
    app.get("/", (_req, res) => {
      operationalError(res, new Error("/srv/minecraft/secret/server.properties"), 500, "Unable to process request");
    });
    const response = await request(app).get("/");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Unable to process request" });
    expect(response.text).not.toContain("/srv/minecraft");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("protects EULA, RAM, and install routes with requireOwner", async () => {
    const source = await import("../routes/versions.js");
    const router = source.default;
    const routes = (router as {
      stack: Array<{
        route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle?: unknown }> };
      }>
    }).stack;
    for (const path of ["/eula", "/ram", "/install"]) {
      const layer = routes.find(item => item.route?.path === path);
      expect(layer?.route?.methods?.post).toBe(true);
      expect(layer?.route?.stack?.length).toBe(2);
      expect(layer?.route?.stack?.[0]?.handle).toBeDefined();
      expect(layer?.route?.stack?.[1]?.handle).toBeDefined();
    }
  });
});
