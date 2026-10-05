import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the built bin against real services: npm run test:live.
// Points at the maintainer's self-hosted OSM stack unless NOMINATIM_URL,
// OVERPASS_URL, VALHALLA_URL or TAGINFO_URL say otherwise. Not part of npm
// test or CI.
const env = {
  NOMINATIM_URL: process.env.NOMINATIM_URL || "https://nominatim.yuiseki.net",
  OVERPASS_URL: process.env.OVERPASS_URL || "https://overpass.yuiseki.net/api",
  VALHALLA_URL: process.env.VALHALLA_URL || "https://valhalla.yuiseki.net",
  TAGINFO_URL: process.env.TAGINFO_URL || "https://taginfo.yuiseki.net",
};

const bin = fileURLToPath(new URL("../../build/index.js", import.meta.url));
const tokyoTower = { lat: 35.6586, lon: 139.7454 };
const tokyoStation = { lat: 35.6812, lon: 139.7671 };

let client: Client;

beforeAll(async () => {
  if (!existsSync(bin)) {
    throw new Error(`${bin} not found; run npm run build first`);
  }
  console.log("live endpoints:", env);
  client = new Client({ name: "osm-mcp-server-live-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [bin],
      env: { PATH: process.env.PATH ?? "", ...env },
    })
  );
});

afterAll(async () => {
  await client?.close();
});

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as { text: string }[];
  expect(result.isError, content.text).toBeFalsy();
  return result.structuredContent as Record<string, any>;
};

describe.concurrent("live", { timeout: 60_000 }, () => {
  it("geocodes Tokyo Tower", async () => {
    const { results } = await call("osm_geocoding", { text: "東京タワー", countrycodes: ["jp"] });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].lat).toBeCloseTo(tokyoTower.lat, 2);
    expect(results[0].lon).toBeCloseTo(tokyoTower.lon, 2);
  });

  it("returns more than one 府中", async () => {
    const { results } = await call("osm_geocoding", { text: "府中", limit: 10 });
    expect(results.length).toBeGreaterThan(1);
  });

  it("reverse geocodes Tokyo Tower to Minato, Japan", async () => {
    const place = await call("osm_reverse_geocoding", { ...tokyoTower, language: "en" });
    expect(place.address.country_code).toBe("jp");
    expect(place.displayName).toMatch(/Minato/);
  });

  it("finds cafes around Tokyo Tower with Overpass", async () => {
    const result = await call("osm_overpass_query", {
      query: `nwr(around:500,${tokyoTower.lat},${tokyoTower.lon})[amenity=cafe];out center;`,
    });
    expect(result.totalElements).toBeGreaterThan(0);
    expect(result.timestampOsmBase).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.elements[0].tags.amenity).toBe("cafe");
  });

  it("reports an Overpass parse error with its line number", async () => {
    const result = await client.callTool({
      name: "osm_overpass_query",
      arguments: { query: "node(1" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/line 1: parse error/);
  });

  it("routes a walk from Tokyo Tower to Tokyo Station", async () => {
    const route = await call("osm_routing", {
      locations: [tokyoTower, tokyoStation],
      costing: "pedestrian",
      include_geometry: true,
    });
    // The walk is about 3.8 km (3.0 km in a straight line); leave room for
    // the data changing.
    expect(route.distanceKm).toBeGreaterThan(3);
    expect(route.distanceKm).toBeLessThan(6);
    expect(route.legs[0].maneuvers.length).toBeGreaterThan(1);
    const [start] = route.geometry.coordinates;
    expect(start[0]).toBeCloseTo(tokyoTower.lon, 2);
    expect(start[1]).toBeCloseTo(tokyoTower.lat, 2);
  });

  it("finds cuisine=ramen with taginfo", async () => {
    const { values } = await call("osm_taginfo_values", { key: "cuisine", query: "ramen", limit: 5 });
    expect(values[0].value).toBe("ramen");
    expect(values[0].count).toBeGreaterThan(1000);
  });

  it("describes amenity=cafe with taginfo", async () => {
    const tag = await call("osm_taginfo_tag", { key: "amenity", value: "cafe", language: "ja" });
    expect(tag.count.all).toBeGreaterThan(100000);
    expect(tag.wiki.map((w: { lang: string }) => w.lang)).toEqual(["en", "ja"]);
    expect(tag.combinations.length).toBeGreaterThan(0);
  });
});
