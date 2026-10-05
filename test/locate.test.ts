import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { locate } from "../src/lib/valhalla.js";
import { mockFetch, requestOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

// A real answer from Valhalla's /locate on foot, cut down to the fields used:
// Tokyo Tower, a point in Tokyo Bay, and a point in the Pacific.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/valhalla-locate-tower-bay-pacific.json", import.meta.url), "utf8")
);

const tokyoTower = { lat: 35.6586, lon: 139.7454 };
const tokyoBay = { lat: 35.55, lon: 139.9 };
const pacific = { lat: 30, lon: -140 };

describe("locate", () => {
  it("asks where each location goes on the network", async () => {
    const fetchMock = mockFetch(fixture);
    await locate([tokyoTower, tokyoBay, pacific], "pedestrian");
    const { url, method, body } = requestOf(fetchMock);
    expect(url.href).toBe("https://valhalla1.openstreetmap.de/locate");
    expect(method).toBe("POST");
    expect(JSON.parse(String(body))).toEqual({
      locations: [tokyoTower, tokyoBay, pacific],
      costing: "pedestrian",
      verbose: true,
    });
  });

  it("returns the nearest point, its distance and the road's names", async () => {
    mockFetch(fixture);
    const [tower, bay] = await locate([tokyoTower, tokyoBay, pacific], "pedestrian");
    expect(tower).toEqual({ lat: 35.658792, lon: 139.745632, distanceM: 30, roadNames: [] });
    // The point in the bay lands on a ferry line, which is why walking there
    // goes by ferry to Kyushu and back. Valhalla itself says 3301.2 m; the
    // distance is computed here so it matches the other tools.
    expect(bay).toEqual({
      lat: 35.554094,
      lon: 139.863899,
      distanceM: 3298,
      roadNames: [
        "オーシャン東九フェリー（東京―徳島―北九州）",
        "Ocean Tokyu Ferry (Tokyo - Tokushima - Kitakyushu)",
      ],
    });
  });

  it("returns null where there is nothing to stand on", async () => {
    mockFetch(fixture);
    const [, , ocean] = await locate([tokyoTower, tokyoBay, pacific], "pedestrian");
    expect(ocean).toBeNull();
  });

  it("picks the nearest edge when they are not in order", async () => {
    const body = structuredClone(fixture);
    body[0].edges = [
      { correlated_lat: 35.66, correlated_lon: 139.75, distance: 500, edge_info: { names: ["far"] } },
      { correlated_lat: 35.6587, correlated_lon: 139.7455, distance: 14, edge_info: { names: ["near"] } },
    ];
    mockFetch(body);
    const [tower] = await locate([tokyoTower, tokyoBay, pacific], "pedestrian");
    expect(tower?.roadNames).toEqual(["near"]);
  });
});
