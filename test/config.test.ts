import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { endpoints, userAgent, version } from "../src/lib/config.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

describe("endpoints", () => {
  it("defaults to the public OpenStreetMap services", () => {
    expect(endpoints({})).toEqual({
      nominatim: "https://nominatim.openstreetmap.org",
      overpass: "https://overpass-api.de/api",
      valhalla: "https://valhalla1.openstreetmap.de",
    });
  });

  it("reads overrides from the environment", () => {
    expect(
      endpoints({
        NOMINATIM_URL: "https://nominatim.example.org",
        OVERPASS_URL: "https://overpass.example.org/api",
        VALHALLA_URL: "https://valhalla.example.org",
      })
    ).toEqual({
      nominatim: "https://nominatim.example.org",
      overpass: "https://overpass.example.org/api",
      valhalla: "https://valhalla.example.org",
    });
  });

  it("drops trailing slashes", () => {
    expect(endpoints({ NOMINATIM_URL: "https://nominatim.example.org//" }).nominatim).toBe(
      "https://nominatim.example.org"
    );
  });

  it("ignores empty values", () => {
    expect(endpoints({ NOMINATIM_URL: "" }).nominatim).toBe(
      "https://nominatim.openstreetmap.org"
    );
  });
});

describe("version", () => {
  it("comes from package.json", () => {
    expect(version).toBe(pkg.version);
  });

  it("is part of the User-Agent", () => {
    expect(userAgent).toBe(
      `osm-mcp-server/${pkg.version} (+https://github.com/yuiseki/osm-mcp-server)`
    );
  });
});
