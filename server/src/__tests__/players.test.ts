import { describe, expect, it } from "vitest";
import { validatePlayerName } from "../routes/players.js";

describe("Group 5 player validation", () => {
  it("rejects invalid player names before console commands", () => {
    expect(validatePlayerName("../console")).toBe(false);
    expect(validatePlayerName("player name")).toBe(false);
    expect(validatePlayerName("player\nstop")).toBe(false);
    expect(validatePlayerName("Valid_Player1")).toBe(true);
  });
});
