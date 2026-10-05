import { afterEach, describe, expect, it, vi } from "vitest";
import { distanceMetres } from "../src/lib/geo.js";
import { buildNearbyQuery, searchNearby } from "../src/lib/nearby.js";
import { mockFetch, requestOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const tokyoTower = { lat: 35.6586, lon: 139.7454 };

describe("buildNearbyQuery", () => {
  it("searches nodes, ways and relations around the point", () => {
    expect(
      buildNearbyQuery({ ...tokyoTower, radiusM: 300, tags: [{ key: "amenity", value: "cafe" }] })
    ).toBe(
      '[out:json][timeout:25];nwr(around:300,35.6586,139.7454)["amenity"="cafe"]->.r;.r out count;.r out center tags 5000;'
    );
  });

  it("requires every tag", () => {
    expect(
      buildNearbyQuery({
        ...tokyoTower,
        radiusM: 500,
        tags: [
          { key: "amenity", value: "restaurant" },
          { key: "cuisine", value: "ramen" },
        ],
      })
    ).toContain('["amenity"="restaurant"]["cuisine"="ramen"]');
  });

  it("matches any of several values", () => {
    expect(
      buildNearbyQuery({ ...tokyoTower, radiusM: 500, tags: [{ key: "amenity", value: ["cafe", "fast_food"] }] })
    ).toContain('["amenity"~"^(cafe|fast_food)$"]');
  });

  it("matches any value when none is given", () => {
    expect(buildNearbyQuery({ ...tokyoTower, radiusM: 500, tags: [{ key: "shop" }] })).toContain('["shop"]');
  });

  // In Japan name is スターバックス and Starbucks is only in name:en and
  // brand:en, so the name filter looks at every name and brand tag.
  it("filters by any name or brand tag, ignoring case", () => {
    expect(
      buildNearbyQuery({ ...tokyoTower, radiusM: 500, tags: [{ key: "amenity" }], name: "Starbucks" })
    ).toContain('[~"^(name|brand)(:.*)?$"~"Starbucks",i]');
  });

  it("escapes quotes and backslashes so input cannot change the query", () => {
    const query = buildNearbyQuery({
      ...tokyoTower,
      radiusM: 500,
      tags: [{ key: 'na"me', value: 'a"];out;(node' }],
    });
    expect(query).toContain('["na\\"me"="a\\"];out;(node"]');
  });

  it("escapes regex characters in values and names", () => {
    const query = buildNearbyQuery({
      ...tokyoTower,
      radiusM: 500,
      tags: [{ key: "cuisine", value: ["noodle;ramen", "a.b"] }],
      name: "C++ (cafe)",
    });
    expect(query).toContain('["cuisine"~"^(noodle;ramen|a\\\\.b)$"]');
    expect(query).toContain('[~"^(name|brand)(:.*)?$"~"C\\\\+\\\\+ \\\\(cafe\\\\)",i]');
  });
});

describe("distanceMetres", () => {
  it("is zero at the same point", () => {
    expect(distanceMetres(tokyoTower, tokyoTower)).toBe(0);
  });

  it("matches a known distance", () => {
    // Tokyo Tower to Tokyo Station is about 3.2 km in a straight line.
    const d = distanceMetres(tokyoTower, { lat: 35.6812, lon: 139.7671 });
    expect(d).toBeGreaterThan(3100);
    expect(d).toBeLessThan(3300);
  });
});

describe("searchNearby", () => {
  const overpass = (elements: unknown[], total = elements.length) => ({
    osm3s: { timestamp_osm_base: "2025-09-14T23:59:55Z" },
    elements: [
      { type: "count", id: 0, tags: { nodes: String(total), ways: "0", relations: "0", total: String(total) } },
      ...elements,
    ],
  });
  const far = { type: "node", id: 1, lat: 35.661, lon: 139.743, tags: { amenity: "cafe", name: "Far" } };
  const near = { type: "node", id: 2, lat: 35.6587, lon: 139.7455, tags: { amenity: "cafe", name: "Near" } };
  const way = {
    type: "way",
    id: 3,
    center: { lat: 35.659, lon: 139.746 },
    tags: { amenity: "cafe" },
  };

  it("returns the results nearest first, with distances", async () => {
    const fetchMock = mockFetch(overpass([far, way, near]));
    const result = await searchNearby({ ...tokyoTower, radiusM: 500, tags: [{ key: "amenity", value: "cafe" }] });
    expect(result.results.map((r) => r.osmId)).toEqual([2, 3, 1]);
    expect(result.results[0]).toEqual({
      osmType: "node",
      osmId: 2,
      name: "Near",
      lat: 35.6587,
      lon: 139.7455,
      distanceM: 14,
      tags: { amenity: "cafe", name: "Near" },
    });
    expect(result.results[1]).toMatchObject({ osmType: "way", name: null, lat: 35.659, lon: 139.746 });
    expect(result).toMatchObject({ timestampOsmBase: "2025-09-14T23:59:55Z", total: 3, truncated: false, incomplete: false });
    const body = new URLSearchParams(String(requestOf(fetchMock).body)).get("data");
    expect(body).toContain("nwr(around:500,35.6586,139.7454)");
  });

  it("keeps the nearest limit results", async () => {
    mockFetch(overpass([far, way, near]));
    const result = await searchNearby({ ...tokyoTower, radiusM: 500, tags: [{ key: "amenity" }], limit: 2 });
    expect(result.results.map((r) => r.osmId)).toEqual([2, 3]);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(3);
  });

  it("says when there were more matches than it could sort", async () => {
    mockFetch(overpass([far, near], 6000));
    const result = await searchNearby({ ...tokyoTower, radiusM: 5000, tags: [{ key: "highway" }] });
    expect(result.total).toBe(6000);
    expect(result.incomplete).toBe(true);
  });
});
