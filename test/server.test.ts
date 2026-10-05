import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startStubOsm } from "./stub-osm.js";

// Talks to the built bin over stdio, the way an MCP client does, with the
// OSM services replaced by a local stub so no network is needed.
const bin = fileURLToPath(new URL("../build/index.js", import.meta.url));

let client: Client;
let stub: Awaited<ReturnType<typeof startStubOsm>>;

beforeAll(async () => {
  if (!existsSync(bin)) {
    throw new Error(`${bin} not found; run npm run build first`);
  }
  stub = await startStubOsm();
  client = new Client({ name: "osm-mcp-server-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [bin],
      env: { PATH: process.env.PATH ?? "", ...stub.env },
    })
  );
});

afterAll(async () => {
  await client?.close();
  await stub?.close();
});

beforeEach(() => {
  stub.routes.clear();
  stub.requests.length = 0;
});

type Text = { type: string; text: string };

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as Text[];
  return { result, text: content.text };
};

// Tool errors come back as results with isError, so the model can read
// them and retry, rather than as protocol errors.
const errorText = async (name: string, args: Record<string, unknown>) => {
  const { result, text } = await call(name, args);
  expect(result.isError).toBe(true);
  return text;
};

// Every successful tool returns structuredContent plus the same thing as JSON
// text, for clients that do not read structuredContent.
const structured = async (name: string, args: Record<string, unknown>) => {
  const { result, text } = await call(name, args);
  expect(result.isError, text).toBeFalsy();
  expect(JSON.parse(text)).toEqual(result.structuredContent);
  return result.structuredContent as Record<string, any>;
};

const fuchu = {
  name: "府中",
  display_name: "府中, 府中市, 東京都, 日本",
  lat: "35.672219",
  lon: "139.4800091",
  osm_type: "node",
  osm_id: 7682981674,
  category: "railway",
  type: "station",
  boundingbox: ["35.667219", "35.677219", "139.4750091", "139.4850091"],
};

describe("osm-mcp-server over stdio", () => {
  it("identifies itself", () => {
    expect(client.getServerVersion()?.name).toBe("osm-mcp-server");
  });

  it("lists the tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "osm_geocoding",
      "osm_isochrone",
      "osm_optimized_route",
      "osm_overpass_query",
      "osm_reverse_geocoding",
      "osm_route_matrix",
      "osm_routing",
      "osm_search_nearby",
      "osm_taginfo_keys",
      "osm_taginfo_tag",
      "osm_taginfo_values",
    ]);
  });

  it("marks every tool as read-only and declares its output", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it("reports an unknown tool as a tool error", async () => {
    expect(await errorText("no_such_tool", {})).toMatch(/no_such_tool not found/);
  });
});

describe("osm_geocoding", () => {
  it("returns every candidate", async () => {
    stub.routes.set("/nominatim/search", () => ({
      body: [fuchu, { ...fuchu, name: "府中", osm_id: 2, display_name: "府中, 板橋區, 新北市, 臺灣" }],
    }));
    const { results } = await structured("osm_geocoding", { text: "府中" });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: "府中", lat: 35.672219, osmId: 7682981674 });
    expect(results[1].displayName).toContain("臺灣");
  });

  it("passes limit, countrycodes and language through", async () => {
    stub.routes.set("/nominatim/search", () => ({ body: [] }));
    await structured("osm_geocoding", {
      text: "府中",
      limit: 3,
      countrycodes: ["jp"],
      language: "ja",
    });
    const [req] = stub.requests;
    expect(req.query.get("limit")).toBe("3");
    expect(req.query.get("countrycodes")).toBe("jp");
    expect(req.query.get("accept-language")).toBe("ja");
    expect(req.headers["user-agent"]).toMatch(/^osm-mcp-server\//);
  });

  it("asks for 5 candidates by default", async () => {
    stub.routes.set("/nominatim/search", () => ({ body: [] }));
    await structured("osm_geocoding", { text: "府中" });
    expect(stub.requests[0].query.get("limit")).toBe("5");
  });

  it("returns an empty list when nothing matches", async () => {
    stub.routes.set("/nominatim/search", () => ({ body: [] }));
    expect(await structured("osm_geocoding", { text: "nowhere" })).toEqual({ results: [] });
  });

  it("reports a missing text as a tool error", async () => {
    expect(await errorText("osm_geocoding", {})).toMatch(/text/);
  });

  it("reports a limit over 20 as a tool error", async () => {
    expect(await errorText("osm_geocoding", { text: "x", limit: 50 })).toMatch(/limit/);
  });

  it("reports an HTTP failure as a tool error", async () => {
    stub.routes.set("/nominatim/search", () => ({ status: 503, body: "busy" }));
    expect(await errorText("osm_geocoding", { text: "x" })).toMatch(
      /Nominatim search failed: 503/
    );
  });
});

describe("osm_reverse_geocoding", () => {
  it("returns the place with its address", async () => {
    stub.routes.set("/nominatim/reverse", () => ({
      body: { ...fuchu, address: { railway: "府中", city: "府中市", country_code: "jp" } },
    }));
    const place = await structured("osm_reverse_geocoding", { lat: 35.6722, lon: 139.48 });
    expect(place).toMatchObject({
      name: "府中",
      lat: 35.672219,
      address: { city: "府中市", country_code: "jp" },
    });
    expect(stub.requests[0].query.get("lat")).toBe("35.6722");
  });

  it("reports non-numeric coordinates as a tool error", async () => {
    expect(
      await errorText("osm_reverse_geocoding", { lat: "35.6", lon: 139.7 })
    ).toMatch(/lat/);
  });

  it("reports out-of-range coordinates as a tool error", async () => {
    expect(await errorText("osm_reverse_geocoding", { lat: 95, lon: 0 })).toMatch(/lat/);
  });

  it("reports an empty spot as a tool error", async () => {
    stub.routes.set("/nominatim/reverse", () => ({ body: { error: "Unable to geocode" } }));
    expect(await errorText("osm_reverse_geocoding", { lat: 0, lon: -140 })).toMatch(
      /Unable to geocode/
    );
  });
});

describe("osm_overpass_query", () => {
  const cafes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ type: "node", id: i + 1, lat: 35.6, lon: 139.7, tags: { amenity: "cafe" } }));

  it("runs the query as JSON and returns the elements", async () => {
    stub.routes.set("/overpass/api/interpreter", () => ({
      body: { osm3s: { timestamp_osm_base: "2025-09-14T23:59:55Z" }, elements: cafes(2) },
    }));
    const result = await structured("osm_overpass_query", {
      query: "node(around:300,35.6586,139.7454)[amenity=cafe];out;",
    });
    expect(result).toEqual({
      timestampOsmBase: "2025-09-14T23:59:55Z",
      totalElements: 2,
      truncated: false,
      elements: cafes(2),
    });
    const [req] = stub.requests;
    expect(req.method).toBe("POST");
    expect(new URLSearchParams(req.body).get("data")).toBe(
      "[out:json];node(around:300,35.6586,139.7454)[amenity=cafe];out;"
    );
  });

  it("keeps 100 elements by default", async () => {
    stub.routes.set("/overpass/api/interpreter", () => ({ body: { elements: cafes(150) } }));
    const result = await structured("osm_overpass_query", { query: "node;out;" });
    expect(result.elements).toHaveLength(100);
    expect(result.totalElements).toBe(150);
    expect(result.truncated).toBe(true);
  });

  it("honours max_elements", async () => {
    stub.routes.set("/overpass/api/interpreter", () => ({ body: { elements: cafes(5) } }));
    const result = await structured("osm_overpass_query", { query: "node;out;", max_elements: 2 });
    expect(result.elements).toHaveLength(2);
  });

  it("reports a non-JSON output format as a tool error", async () => {
    expect(await errorText("osm_overpass_query", { query: "[out:xml];node(1);out;" })).toMatch(
      /Only JSON output is supported/
    );
    expect(stub.requests).toHaveLength(0);
  });

  it("reports a parse error with Overpass's message", async () => {
    stub.routes.set("/overpass/api/interpreter", () => ({
      status: 400,
      body: '<p><strong style="color:#FF0000">Error</strong>: line 1: parse error: Unexpected end of input. </p>',
    }));
    expect(await errorText("osm_overpass_query", { query: "node(1" })).toBe(
      "Overpass failed: 400 Bad Request\nline 1: parse error: Unexpected end of input."
    );
  });

  it("reports a timed-out query as a tool error", async () => {
    stub.routes.set("/overpass/api/interpreter", () => ({
      body: { elements: [], remark: "runtime error: Query timed out in \"query\" at line 1 after 2 seconds." },
    }));
    expect(await errorText("osm_overpass_query", { query: "nwr;out;" })).toMatch(/timed out/);
  });
});

describe("osm_routing", () => {
  const tokyoWalk = JSON.parse(
    readFileSync(
      new URL("./fixtures/valhalla-route-tokyo-tower-to-tokyo-station.json", import.meta.url),
      "utf8"
    )
  );
  const locations = [
    { lat: 35.6586, lon: 139.7454 },
    { lat: 35.6812, lon: 139.7671 },
  ];

  it("returns the route summary and directions", async () => {
    stub.routes.set("/valhalla/route", () => ({ body: tokyoWalk }));
    const result = await structured("osm_routing", { locations, costing: "pedestrian", language: "ja-JP" });
    expect(result).toMatchObject({ costing: "pedestrian", distanceKm: 3.801, durationSeconds: 2744 });
    expect(result.legs[0].maneuvers[0].instruction).toBe("Walk northeast on the walkway.");
    expect(result.geometry).toBeUndefined();
    expect(JSON.parse(stub.requests[0].body)).toMatchObject({ costing: "pedestrian", language: "ja-JP" });
  });

  it("drives by default", async () => {
    stub.routes.set("/valhalla/route", () => ({ body: tokyoWalk }));
    await structured("osm_routing", { locations });
    expect(JSON.parse(stub.requests[0].body).costing).toBe("auto");
  });

  it("returns the line on request", async () => {
    stub.routes.set("/valhalla/route", () => ({ body: tokyoWalk }));
    const result = await structured("osm_routing", { locations, include_geometry: true });
    expect(result.geometry.coordinates).toHaveLength(216);
  });

  it("reports fewer than two locations as a tool error", async () => {
    expect(await errorText("osm_routing", { locations: locations.slice(0, 1) })).toMatch(/locations/);
  });

  it("reports an unknown costing as a tool error", async () => {
    expect(await errorText("osm_routing", { locations, costing: "hovercraft" })).toMatch(/costing/);
  });

  it("reports Valhalla's error as a tool error", async () => {
    stub.routes.set("/valhalla/route", () => ({
      status: 400,
      body: { error_code: 171, error: "No suitable edges near location", status_code: 400 },
    }));
    expect(await errorText("osm_routing", { locations })).toBe(
      "Valhalla route failed: 400 Bad Request\nNo suitable edges near location (error_code 171)"
    );
  });
});

describe("taginfo tools", () => {
  const fixture = (name: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/taginfo-${name}.json`, import.meta.url), "utf8"));
  const api = "/taginfo/api/4";

  it("osm_taginfo_keys finds keys", async () => {
    stub.routes.set(`${api}/keys/all`, () => ({ body: fixture("keys-cuisine") }));
    const result = await structured("osm_taginfo_keys", { query: "cuisine" });
    expect(result.keys[0]).toMatchObject({ key: "cuisine", count: 1433692 });
    expect(stub.requests[0].query.get("rp")).toBe("10");
  });

  it("osm_taginfo_values lists values of a key", async () => {
    stub.routes.set(`${api}/key/values`, () => ({ body: fixture("values-cuisine-ramen") }));
    const result = await structured("osm_taginfo_values", { key: "cuisine", query: "ramen", limit: 3 });
    expect(result.values[0]).toEqual({ value: "ramen", count: 8213, fraction: 0.0057 });
    expect(stub.requests[0].query.get("query")).toBe("ramen");
    expect(stub.requests[0].query.get("rp")).toBe("3");
  });

  it("osm_taginfo_tag describes a tag", async () => {
    stub.routes.set(`${api}/tag/stats`, () => ({ body: fixture("tag-stats-amenity-cafe") }));
    stub.routes.set(`${api}/tag/wiki_pages`, () => ({ body: fixture("tag-wiki-amenity-cafe") }));
    stub.routes.set(`${api}/tag/combinations`, () => ({ body: fixture("tag-combinations-amenity-cafe") }));
    const result = await structured("osm_taginfo_tag", { key: "amenity", value: "cafe", language: "ja" });
    expect(result.count.all).toBe(618379);
    expect(result.wiki.map((w: { lang: string }) => w.lang)).toEqual(["en", "ja"]);
    expect(result.combinations[0].key).toBe("name");
  });

  it("osm_taginfo_tag describes a key without a value", async () => {
    stub.routes.set(`${api}/key/stats`, () => ({ body: fixture("key-stats-cuisine") }));
    stub.routes.set(`${api}/key/wiki_pages`, () => ({ body: fixture("key-wiki-cuisine") }));
    stub.routes.set(`${api}/key/combinations`, () => ({ body: fixture("key-combinations-cuisine") }));
    const result = await structured("osm_taginfo_tag", { key: "cuisine" });
    expect(result).toMatchObject({ key: "cuisine", value: null });
  });

  it("reports taginfo's error as a tool error", async () => {
    stub.routes.set(`${api}/key/values`, () => ({
      status: 412,
      body: { error: "number of results too large, use paging" },
    }));
    expect(await errorText("osm_taginfo_values", { key: "amenity" })).toBe(
      "taginfo failed: 412 Precondition Failed\nnumber of results too large, use paging"
    );
  });

  it("reports an empty key as a tool error", async () => {
    expect(await errorText("osm_taginfo_values", { key: "" })).toMatch(/key/);
  });
});

describe("osm_search_nearby", () => {
  const answer = (elements: unknown[]) => ({
    body: {
      osm3s: { timestamp_osm_base: "2025-09-14T23:59:55Z" },
      elements: [
        { type: "count", id: 0, tags: { total: String(elements.length) } },
        ...elements,
      ],
    },
  });
  const near = { type: "node", id: 2, lat: 35.6587, lon: 139.7455, tags: { amenity: "cafe", name: "Near" } };
  const far = { type: "node", id: 1, lat: 35.661, lon: 139.743, tags: { amenity: "cafe" } };

  it("returns places nearest first", async () => {
    stub.routes.set("/overpass/api/interpreter", () => answer([far, near]));
    const result = await structured("osm_search_nearby", {
      lat: 35.6586,
      lon: 139.7454,
      tags: [{ key: "amenity", value: "cafe" }],
    });
    expect(result.results.map((r: { osmId: number }) => r.osmId)).toEqual([2, 1]);
    expect(result.results[0]).toMatchObject({ name: "Near", distanceM: 14 });
    const query = new URLSearchParams(stub.requests[0].body).get("data");
    expect(query).toContain('nwr(around:500,35.6586,139.7454)["amenity"="cafe"]');
  });

  it("passes radius, several values and name through", async () => {
    stub.routes.set("/overpass/api/interpreter", () => answer([]));
    await structured("osm_search_nearby", {
      lat: 35.6586,
      lon: 139.7454,
      radius_m: 1000,
      tags: [{ key: "amenity", value: ["cafe", "restaurant"] }],
      name: "Doutor",
    });
    const query = new URLSearchParams(stub.requests[0].body).get("data");
    expect(query).toContain('around:1000,');
    expect(query).toContain('["amenity"~"^(cafe|restaurant)$"][~"^(name|brand)(:.*)?$"~"Doutor",i]');
  });

  it("reports a search without tags as a tool error", async () => {
    expect(await errorText("osm_search_nearby", { lat: 35.6, lon: 139.7, tags: [] })).toMatch(/tags/);
  });

  it("reports a radius over 10 km as a tool error", async () => {
    expect(
      await errorText("osm_search_nearby", { lat: 35.6, lon: 139.7, radius_m: 20000, tags: [{ key: "shop" }] })
    ).toMatch(/radius_m/);
  });
});

describe("osm_isochrone", () => {
  const fixture = (name: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/valhalla-isochrone-${name}.json`, import.meta.url), "utf8"));

  it("returns the reachable areas", async () => {
    stub.routes.set("/valhalla/isochrone", () => ({ body: fixture("tokyo-tower-walk-10-20") }));
    const result = await structured("osm_isochrone", {
      lat: 35.6586,
      lon: 139.7454,
      costing: "pedestrian",
      minutes: [10, 20],
    });
    expect(result.contours.map((c: { value: number }) => c.value)).toEqual([10, 20]);
    expect(result.snappedTo.distanceM).toBe(30);
    expect(JSON.parse(stub.requests[0].body).contours).toEqual([{ time: 10 }, { time: 20 }]);
  });

  it("reports a point with no road as a tool error", async () => {
    stub.routes.set("/valhalla/isochrone", () => ({ body: fixture("pacific-no-road") }));
    expect(await errorText("osm_isochrone", { lat: 30, lon: -140, minutes: [10] })).toMatch(/No road or path/);
  });

  it("reports neither minutes nor km as a tool error", async () => {
    expect(await errorText("osm_isochrone", { lat: 35.6, lon: 139.7 })).toMatch(/minutes or km/);
  });

  it("reports more than four contours as a tool error", async () => {
    expect(
      await errorText("osm_isochrone", { lat: 35.6, lon: 139.7, minutes: [5, 10, 15, 20, 25] })
    ).toMatch(/minutes/);
  });
});

describe("osm_route_matrix and osm_optimized_route", () => {
  const fixture = (name: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/valhalla-${name}.json`, import.meta.url), "utf8"));
  const tower = { lat: 35.6586, lon: 139.7454 };
  const station = { lat: 35.6812, lon: 139.7671 };
  const shibuya = { lat: 35.6595, lon: 139.7005 };
  const bay = { lat: 35.55, lon: 139.9 };
  const skytree = { lat: 35.7101, lon: 139.8107 };

  it("osm_route_matrix returns the table and the snapped locations", async () => {
    stub.routes.set("/valhalla/sources_to_targets", () => ({ body: fixture("matrix-walk-2x3") }));
    const result = await structured("osm_route_matrix", {
      sources: [tower, station],
      targets: [station, shibuya, bay],
      costing: "pedestrian",
    });
    expect(result.matrix[0][0]).toEqual({ durationSeconds: 2743, distanceKm: 3.801 });
    expect(result.targets[2].snappedTo.distanceM).toBeGreaterThan(3000);
  });

  it("osm_route_matrix drives by default", async () => {
    stub.routes.set("/valhalla/sources_to_targets", () => ({ body: fixture("matrix-walk-2x3") }));
    await structured("osm_route_matrix", { sources: [tower, station], targets: [station, shibuya, bay] });
    expect(JSON.parse(stub.requests[0].body).costing).toBe("auto");
  });

  it("osm_route_matrix reports an empty list as a tool error", async () => {
    expect(await errorText("osm_route_matrix", { sources: [], targets: [station] })).toMatch(/sources/);
  });

  it("osm_optimized_route returns the visiting order", async () => {
    stub.routes.set("/valhalla/optimized_route", () => ({ body: fixture("optimized-tokyo-loop") }));
    const result = await structured("osm_optimized_route", {
      locations: [tower, station, shibuya, skytree, tower],
    });
    expect(result.order).toEqual([0, 2, 3, 1, 4]);
    expect(result.legs).toHaveLength(4);
  });

  it("osm_optimized_route needs at least three locations", async () => {
    expect(await errorText("osm_optimized_route", { locations: [tower, station] })).toMatch(/locations/);
  });

  it("reports Valhalla's error as a tool error", async () => {
    stub.routes.set("/valhalla/optimized_route", () => ({
      status: 400,
      body: { error_code: 154, error: "Path distance exceeds the max distance limit: 400000 meters" },
    }));
    expect(
      await errorText("osm_optimized_route", { locations: [tower, station, { lat: 30, lon: -140 }] })
    ).toMatch(/max distance limit/);
  });
});
