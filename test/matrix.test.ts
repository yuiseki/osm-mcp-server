import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { optimizedRoute, routeMatrix } from "../src/lib/valhalla.js";
import { locateOnTheSpot, mockFetchByPath, requestTo, type Reply } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Real answers from Valhalla.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/valhalla-${name}.json`, import.meta.url), "utf8"));

// /locate answered from the real answer for the points it covers (Tokyo
// Tower, Tokyo Bay), and on the spot for the rest.
const realLocate = fixture("locate-tower-bay-pacific") as { input_lat: number; input_lon: number }[];
const locate = (body: { locations: { lat: number; lon: number }[] }): Reply => {
  const onTheSpot = locateOnTheSpot(body).body as unknown[];
  return {
    body: body.locations.map(
      ({ lat, lon }, i) => realLocate.find((r) => r.input_lat === lat && r.input_lon === lon) ?? onTheSpot[i]
    ),
  };
};

const mockMatrix = (matrix: unknown) => mockFetchByPath({ "/sources_to_targets": matrix, "/locate": locate });
const mockOptimized = (trip: unknown) => mockFetchByPath({ "/optimized_route": trip, "/locate": locate });

const tokyoTower = { lat: 35.6586, lon: 139.7454 };
const tokyoStation = { lat: 35.6812, lon: 139.7671 };
const shibuya = { lat: 35.6595, lon: 139.7005 };
const tokyoBay = { lat: 35.55, lon: 139.9 };
const skytree = { lat: 35.7101, lon: 139.8107 };

describe("routeMatrix", () => {
  it("asks for every source to every target", async () => {
    const fetchMock = mockMatrix(fixture("matrix-walk-2x3"));
    await routeMatrix([tokyoTower, tokyoStation], [tokyoStation, shibuya, tokyoBay], { costing: "pedestrian" });
    const { url, method, body } = requestTo(fetchMock, "/sources_to_targets");
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
    mockMatrix(fixture("matrix-walk-2x3"));
    const result = await routeMatrix([tokyoTower, tokyoStation], [tokyoStation, shibuya, tokyoBay], {
      costing: "pedestrian",
    });
    expect(result.costing).toBe("pedestrian");
    expect(result.matrix).toHaveLength(2);
    expect(result.matrix[0]).toHaveLength(3);
    expect(result.matrix[0][0]).toEqual({ durationSeconds: 2743, distanceKm: 3.801 });
    expect(result.matrix[1][0]).toEqual({ durationSeconds: 0, distanceKm: 0 });
  });

  it("says where each location was placed and on what", async () => {
    const fetchMock = mockMatrix(fixture("matrix-walk-2x3"));
    const result = await routeMatrix([tokyoTower, tokyoStation], [tokyoStation, shibuya, tokyoBay], {
      costing: "pedestrian",
    });
    expect(result.sources[0]).toEqual({
      ...tokyoTower,
      snappedTo: { lat: 35.658792, lon: 139.745632, distanceM: 30, roadNames: [] },
    });
    expect(result.sources[1].snappedTo?.roadNames).toEqual(["road 1"]);
    expect(result.targets[0].snappedTo?.roadNames).toEqual(["road 2"]);
    // The point in Tokyo Bay is placed on a ferry line 3.3 km away, which is
    // why walking there comes out at over 2000 km.
    expect(result.targets[2].snappedTo?.distanceM).toBe(3298);
    expect(result.targets[2].snappedTo?.roadNames[1]).toBe("Ocean Tokyu Ferry (Tokyo - Tokushima - Kitakyushu)");
    expect(result.matrix[0][2]?.distanceKm).toBeGreaterThan(2000);
    // One /locate for all of them, sources first.
    expect(JSON.parse(String(requestTo(fetchMock, "/locate").body)).locations).toEqual([
      tokyoTower,
      tokyoStation,
      tokyoStation,
      shibuya,
      tokyoBay,
    ]);
  });

  it("marks a pair with no route as null", async () => {
    const body = fixture("matrix-walk-2x3");
    body.sources_to_targets[0][1] = { from_index: 0, to_index: 1, time: null, distance: null };
    mockMatrix(body);
    const result = await routeMatrix([tokyoTower, tokyoStation], [tokyoStation, shibuya, tokyoBay], {
      costing: "pedestrian",
    });
    expect(result.matrix[0][1]).toBeNull();
  });
});

describe("optimizedRoute", () => {
  it("posts the locations to optimized_route", async () => {
    const fetchMock = mockOptimized(fixture("optimized-tokyo-loop"));
    await optimizedRoute([tokyoTower, tokyoStation, shibuya, skytree, tokyoTower], {
      costing: "auto",
      language: "ja-JP",
    });
    const { url, body } = requestTo(fetchMock, "/optimized_route");
    expect(url.href).toBe("https://valhalla1.openstreetmap.de/optimized_route");
    expect(JSON.parse(String(body))).toEqual({
      locations: [tokyoTower, tokyoStation, shibuya, skytree, tokyoTower],
      costing: "auto",
      units: "kilometers",
      language: "ja-JP",
    });
  });

  it("returns the order the locations are visited in", async () => {
    mockOptimized(fixture("optimized-tokyo-loop"));
    const result = await optimizedRoute([tokyoTower, tokyoStation, shibuya, skytree, tokyoTower], {
      costing: "auto",
    });
    expect(result.order).toEqual([0, 2, 3, 1, 4]);
    // Locations stay in the order they were given.
    expect(result.locations.map((l) => l.snappedTo?.roadNames)).toEqual([
      [],
      ["road 1"],
      ["road 2"],
      ["road 3"],
      [],
    ]);
    expect(result.legs).toHaveLength(4);
    expect(result).toMatchObject({ costing: "auto", distanceKm: 37.141, durationSeconds: 3984 });
  });

  it("returns the line on request", async () => {
    mockOptimized(fixture("optimized-tokyo-loop"));
    const result = await optimizedRoute([tokyoTower, tokyoStation, shibuya, skytree, tokyoTower], {
      costing: "auto",
      includeGeometry: true,
    });
    expect(result.geometry?.type).toBe("LineString");
    const [start] = result.geometry!.coordinates;
    expect(start[0]).toBeCloseTo(tokyoTower.lon, 2);
  });
});
