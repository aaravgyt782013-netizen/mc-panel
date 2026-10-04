import { describe, expect, it } from "vitest";
import { validateProperties } from "../routes/properties.js";

describe("Group 5 server.properties validation", () => {
  it("rejects invalid keys and values", () => {
    expect(validateProperties({"bad key":"true"})).toBe(false);
    expect(validateProperties({"motd":"hello\nstop"})).toBe(false);
    expect(validateProperties({"motd":"x".repeat(513)})).toBe(false);
    expect(validateProperties({"motd":"hello","view-distance":"10"})).toBe(true);
  });

  it("rejects non-object and oversized property maps", () => {
    expect(validateProperties(null)).toBe(false);
    const tooMany = Object.fromEntries(Array.from({length:257}, (_, i) => ["key"+i, "value"]));
    expect(validateProperties(tooMany)).toBe(false);
  });
});
