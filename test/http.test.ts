import { afterEach, describe, expect, it, vi } from "vitest";
import { userAgent } from "../src/lib/config.js";
import { request } from "../src/lib/http.js";
import { mockFetch, requestOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("adds the User-Agent and keeps the caller's headers", async () => {
    const fetchMock = mockFetch({});
    await request("Test", "https://example.org/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const { method, headers } = requestOf(fetchMock);
    expect(method).toBe("POST");
    expect(headers.get("User-Agent")).toBe(userAgent);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("puts the label, status and response body in the error", async () => {
    mockFetch('{"error":"No suitable edges near location"}', {
      status: 400,
      statusText: "Bad Request",
    });
    await expect(request("Valhalla route", "https://example.org/")).rejects.toThrow(
      'Valhalla route failed: 400 Bad Request\n{"error":"No suitable edges near location"}'
    );
  });

  it("leaves the body out of the error when it is empty", async () => {
    mockFetch("", { status: 504, statusText: "Gateway Timeout" });
    await expect(request("Overpass", "https://example.org/")).rejects.toThrow(
      /^Overpass failed: 504 Gateway Timeout$/
    );
  });
});
