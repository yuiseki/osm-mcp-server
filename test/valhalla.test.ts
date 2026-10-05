import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userAgent } from "../src/lib/config.js";
import { jsonErrorDetail } from "../src/lib/http.js";
import { decodePolyline6, route } from "../src/lib/valhalla.js";
import { mockFetch, requestOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// A real answer from Valhalla for a walk from Tokyo Tower to Tokyo Station,
// with the maneuvers cut down to the first three.
const tokyoWalk = JSON.parse(
  readFileSync(
    new URL("./fixtures/valhalla-route-tokyo-tower-to-tokyo-station.json", import.meta.url),
    "utf8"
  )
);

const towerToStation = [
  { lat: 35.6586, lon: 139.7454 },
  { lat: 35.6812, lon: 139.7671 },
];

describe("decodePolyline6", () => {
  // Expected values come from the Python polyline package (precision 6).
  it("decodes to [lon, lat] pairs", () => {
    expect(decodePolyline6("oam_cA_ukpiGg@Yvs{qcCgt`{T_pmq_Abkml_H")).toEqual([
      [139.745632, 35.658792],
      [139.745645, 35.658812],
      [151.215297, -33.856784],
      [-0.000001, 0],
    ]);
  });

  it("decodes the whole shape of a real route", () => {
    const coordinates = decodePolyline6(tokyoWalk.trip.legs[0].shape);
    expect(coordinates).toHaveLength(216);
    expect(coordinates[0]).toEqual([139.745632, 35.658792]);
    expect(coordinates.at(-1)).toEqual([139.767109, 35.681198]);
  });

  it("returns nothing for an empty shape", () => {
    expect(decodePolyline6("")).toEqual([]);
  });
});

describe("jsonErrorDetail", () => {
  it("keeps Valhalla's message and code", () => {
    expect(
      jsonErrorDetail(
        '{"error_code":125,"error":"No costing method found: \'hovercraft\'","status_code":400,"status":"Bad Request"}'
      )
    ).toBe("No costing method found: 'hovercraft' (error_code 125)");
  });

  it("passes anything else through", () => {
    expect(jsonErrorDetail("<html>bad gateway</html>")).toBe("<html>bad gateway</html>");
  });
});

describe("route", () => {
  it("posts the locations, costing and language", async () => {
    const fetchMock = mockFetch(tokyoWalk);
    await route(towerToStation, { costing: "pedestrian", language: "ja-JP" });
    const { url, method, headers, body } = requestOf(fetchMock);
    expect(url.href).toBe("https://valhalla1.openstreetmap.de/route");
    expect(method).toBe("POST");
    expect(headers.get("User-Agent")).toBe(userAgent);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(body))).toEqual({
      locations: towerToStation,
      costing: "pedestrian",
      units: "kilometers",
      language: "ja-JP",
    });
  });

  it("summarises the trip and its maneuvers", async () => {
    mockFetch(tokyoWalk);
    const result = await route(towerToStation, { costing: "pedestrian" });
    expect(result).toMatchObject({
      costing: "pedestrian",
      distanceKm: 3.801,
      durationSeconds: 2744,
      hasToll: false,
      hasHighway: false,
      hasFerry: false,
    });
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].distanceKm).toBe(tokyoWalk.trip.legs[0].summary.length);
    expect(result.legs[0].maneuvers[0]).toEqual({
      instruction: "Walk northeast on the walkway.",
      distanceKm: 0.029,
      durationSeconds: 23,
    });
    expect(result.geometry).toBeUndefined();
  });

  it("keeps street names when Valhalla gives them", async () => {
    const withStreet = structuredClone(tokyoWalk);
    withStreet.trip.legs[0].maneuvers[1].street_names = ["東京タワー通り"];
    mockFetch(withStreet);
    const result = await route(towerToStation, { costing: "pedestrian" });
    expect(result.legs[0].maneuvers[1].streetNames).toEqual(["東京タワー通り"]);
  });

  it("joins the legs into one GeoJSON line on request", async () => {
    const twoLegs = structuredClone(tokyoWalk);
    twoLegs.trip.legs.push({ ...twoLegs.trip.legs[0], shape: "oam_cA_ukpiGg@Y" });
    mockFetch(twoLegs);
    const result = await route(towerToStation, { costing: "pedestrian", includeGeometry: true });
    expect(result.geometry?.type).toBe("LineString");
    // The second leg starts where the first ends, so its first point is
    // dropped: 216 + 2 - 1.
    expect(result.geometry?.coordinates).toHaveLength(217);
  });

  it("puts Valhalla's error in the thrown error", async () => {
    mockFetch(
      { error_code: 171, error: "No suitable edges near location", status_code: 400 },
      { status: 400, statusText: "Bad Request" }
    );
    await expect(route(towerToStation, { costing: "auto" })).rejects.toThrow(
      "Valhalla route failed: 400 Bad Request\nNo suitable edges near location (error_code 171)"
    );
  });

  it("uses VALHALLA_URL", async () => {
    vi.stubEnv("VALHALLA_URL", "https://valhalla.example.org/");
    const fetchMock = mockFetch(tokyoWalk);
    await route(towerToStation, { costing: "auto" });
    expect(requestOf(fetchMock).url.href).toBe("https://valhalla.example.org/route");
  });
});
