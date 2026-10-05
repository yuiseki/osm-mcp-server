import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isochrone } from "../src/lib/valhalla.js";
import { mockFetch, requestOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Real answers from Valhalla, asked with show_locations: a 10 and 20 minute
// walk from Tokyo Tower, and a point in the Pacific with no road nearby.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/valhalla-isochrone-${name}.json`, import.meta.url), "utf8"));

const tokyoTower = { lat: 35.6586, lon: 139.7454 };

describe("isochrone", () => {
  it("asks for polygons and the snapped location", async () => {
    const fetchMock = mockFetch(fixture("tokyo-tower-walk-10-20"));
    await isochrone(tokyoTower, { costing: "pedestrian", minutes: [20, 10] });
    const { url, method, body } = requestOf(fetchMock);
    expect(url.href).toBe("https://valhalla1.openstreetmap.de/isochrone");
    expect(method).toBe("POST");
    expect(JSON.parse(String(body))).toEqual({
      locations: [tokyoTower],
      costing: "pedestrian",
      contours: [{ time: 10 }, { time: 20 }],
      polygons: true,
      show_locations: true,
    });
  });

  it("asks for distances in km", async () => {
    const fetchMock = mockFetch(fixture("tokyo-tower-walk-10-20"));
    await isochrone(tokyoTower, { costing: "auto", km: [2] });
    expect(JSON.parse(String(requestOf(fetchMock).body)).contours).toEqual([{ distance: 2 }]);
  });

  it("returns one polygon per contour, smallest first, without styling", async () => {
    mockFetch(fixture("tokyo-tower-walk-10-20"));
    const result = await isochrone(tokyoTower, { costing: "pedestrian", minutes: [10, 20] });
    expect(result.costing).toBe("pedestrian");
    expect(result.contours.map((c) => [c.value, c.unit])).toEqual([
      [10, "minutes"],
      [20, "minutes"],
    ]);
    expect(Object.keys(result.contours[0])).toEqual(["value", "unit", "geometry"]);
    expect(result.contours[0].geometry.type).toBe("Polygon");
    const ring = result.contours[0].geometry.coordinates[0] as number[][];
    expect(ring[0]).toEqual(ring.at(-1));
  });

  it("says where the origin was snapped to", async () => {
    mockFetch(fixture("tokyo-tower-walk-10-20"));
    const { origin, snappedTo } = await isochrone(tokyoTower, { costing: "pedestrian", minutes: [10] });
    expect(origin).toEqual(tokyoTower);
    expect(snappedTo).toEqual({ lat: 35.658792, lon: 139.745632, distanceM: 30 });
  });

  it("throws when there is no road near the origin", async () => {
    mockFetch(fixture("pacific-no-road"));
    await expect(isochrone({ lat: 30, lon: -140 }, { costing: "auto", minutes: [10] })).rejects.toThrow(
      "No road or path for auto near 30, -140"
    );
  });

  it("needs exactly one of minutes and km", async () => {
    await expect(isochrone(tokyoTower, { costing: "auto" })).rejects.toThrow("exactly one of minutes or km");
    await expect(isochrone(tokyoTower, { costing: "auto", minutes: [5], km: [1] })).rejects.toThrow(
      "exactly one of minutes or km"
    );
  });
});
