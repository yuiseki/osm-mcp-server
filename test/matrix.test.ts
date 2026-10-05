import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { optimizedRoute, routeMatrix } from "../src/lib/valhalla.js";
import { mockFetch, requestOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Real answers from Valhalla.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/valhalla-${name}.json`, import.meta.url), "utf8"));

const tokyoTower = { lat: 35.6586, lon: 139.7454 };
const tokyoStation = { lat: 35.6812, lon: 139.7671 };
const shibuya = { lat: 35.6595, lon: 139.7005 };
const tokyoBay = { lat: 35.55, lon: 139.9 };
const skytree = { lat: 35.7101, lon: 139.8107 };

describe("routeMatrix", () => {
  it("asks for every source to every target", async () => {
    const fetchMock = mockFetch(fixture("matrix-walk-2x3"));
    await routeMatrix([tokyoTower, tokyoStation], [tokyoStation, shibuya, tokyoBay], { costing: "pedestrian" });
    const { url, method, body } = requestOf(fetchMock);
    expect(url.href).toBe("https://valhalla1.openstreetmap.de/sources_to_targets");
    expect(method).toBe("POST");
    expect(JSON.parse(String(body))).toEqual({
      sources: [tokyoTower, tokyoStation],
      targets: [tokyoStation, shibuya, tokyoBay],
      costing: "pedestrian",
      units: "kilometers",
    });
  });

  it("returns a row per source with time and distance per target", async () => {
    mockFetch(fixture("matrix-walk-2x3"));
    const result = await routeMatrix([tokyoTower, tokyoStation], [tokyoStation, shibuya, tokyoBay], {
      costing: "pedestrian",
    });
    expect(result.costing).toBe("pedestrian");
    expect(result.matrix).toHaveLength(2);
    expect(result.matrix[0]).toHaveLength(3);
    expect(result.matrix[0][0]).toEqual({ durationSeconds: 2743, distanceKm: 3.801 });
    expect(result.matrix[1][0]).toEqual({ durationSeconds: 0, distanceKm: 0 });
  });

  it("says where each location was snapped to", async () => {
    mockFetch(fixture("matrix-walk-2x3"));
    const result = await routeMatrix([tokyoTower, tokyoStation], [tokyoStation, shibuya, tokyoBay], {
      costing: "pedestrian",
    });
    expect(result.sources[0]).toEqual({
      ...tokyoTower,
      snappedTo: { lat: 35.658792, lon: 139.745632, distanceM: 30 },
    });
    // The point in Tokyo Bay is placed on a road 3.3 km away, which is why
    // walking there comes out at over 2000 km.
    expect(result.targets[2].snappedTo.distanceM).toBeGreaterThan(3000);
    expect(result.matrix[0][2]?.distanceKm).toBeGreaterThan(2000);
  });

  it("marks a pair with no route as null", async () => {
    const body = fixture("matrix-walk-2x3");
    body.sources_to_targets[0][1] = { from_index: 0, to_index: 1, time: null, distance: null };
    mockFetch(body);
    const result = await routeMatrix([tokyoTower, tokyoStation], [tokyoStation, shibuya, tokyoBay], {
      costing: "pedestrian",
    });
    expect(result.matrix[0][1]).toBeNull();
  });
});

describe("optimizedRoute", () => {
  it("posts the locations to optimized_route", async () => {
    const fetchMock = mockFetch(fixture("optimized-tokyo-loop"));
    await optimizedRoute([tokyoTower, tokyoStation, shibuya, skytree, tokyoTower], {
      costing: "auto",
      language: "ja-JP",
    });
    const { url, body } = requestOf(fetchMock);
    expect(url.href).toBe("https://valhalla1.openstreetmap.de/optimized_route");
    expect(JSON.parse(String(body))).toEqual({
      locations: [tokyoTower, tokyoStation, shibuya, skytree, tokyoTower],
      costing: "auto",
      units: "kilometers",
      language: "ja-JP",
    });
  });

  it("returns the order the locations are visited in", async () => {
    mockFetch(fixture("optimized-tokyo-loop"));
    const result = await optimizedRoute([tokyoTower, tokyoStation, shibuya, skytree, tokyoTower], {
      costing: "auto",
    });
    expect(result.order).toEqual([0, 2, 3, 1, 4]);
    expect(result.legs).toHaveLength(4);
    expect(result).toMatchObject({ costing: "auto", distanceKm: 37.141, durationSeconds: 3984 });
  });

  it("returns the line on request", async () => {
    mockFetch(fixture("optimized-tokyo-loop"));
    const result = await optimizedRoute([tokyoTower, tokyoStation, shibuya, skytree, tokyoTower], {
      costing: "auto",
      includeGeometry: true,
    });
    expect(result.geometry?.type).toBe("LineString");
    const [start] = result.geometry!.coordinates;
    expect(start[0]).toBeCloseTo(tokyoTower.lon, 2);
  });
});
