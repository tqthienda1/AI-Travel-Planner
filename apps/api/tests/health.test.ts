import { PROBLEM_CONTENT_TYPE, ProblemDetailsSchema } from "@ai-travel-planner/shared";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("API harness smoke tests", () => {
  const app = buildApp({ logger: false });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns 200 OK", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "ai-travel-planner-api",
    });
  });

  it("returns RFC 9457 Problem Details for unknown routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/does-not-exist",
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);

    const parsed = ProblemDetailsSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("https://ai-travel-planner.local/problems/not-found");
      expect(parsed.data.status).toBe(404);
      expect(parsed.data.instance).toBe("/does-not-exist");
    }
  });
});
