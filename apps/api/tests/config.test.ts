import { describe, expect, it } from "vitest";
import { parseServerConfig } from "../src/config.js";

describe("parseServerConfig", () => {
  it("uses default PORT (3001) and HOST (0.0.0.0) when env is empty", () => {
    expect(parseServerConfig({})).toEqual({
      port: 3001,
      host: "0.0.0.0",
    });
  });

  it("parses custom valid PORT and trims HOST", () => {
    expect(
      parseServerConfig({
        PORT: "8080",
        HOST: " 127.0.0.1 ",
      }),
    ).toEqual({
      port: 8080,
      host: "127.0.0.1",
    });
  });

  it("rejects invalid PORT values", () => {
    for (const invalidPort of ["abc", "0", "70000", "3001.5"]) {
      expect(() => parseServerConfig({ PORT: invalidPort })).toThrow();
    }
  });

  it("rejects blank HOST values", () => {
    expect(() => parseServerConfig({ HOST: "   " })).toThrow();
  });
});
