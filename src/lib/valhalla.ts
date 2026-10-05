import { endpoints } from "./config.js";
import { distanceMetres, type LatLon } from "./geo.js";
import { jsonErrorDetail, request } from "./http.js";

export const costings = [
  "auto",
  "pedestrian",
  "bicycle",
  "bus",
  "taxi",
  "truck",
  "motor_scooter",
  "motorcycle",
] as const;

export type Costing = (typeof costings)[number];

export type Location = { lat: number; lon: number };

export type Maneuver = {
  instruction: string;
  distanceKm: number;
  durationSeconds: number;
  streetNames?: string[];
};

export type Route = {
  costing: Costing;
  distanceKm: number;
  durationSeconds: number;
  hasToll: boolean;
  hasHighway: boolean;
  hasFerry: boolean;
  legs: {
    distanceKm: number;
    durationSeconds: number;
    maneuvers: Maneuver[];
  }[];
  geometry?: { type: "LineString"; coordinates: [number, number][] };
};

type ValhallaSummary = {
  length: number;
  time: number;
  has_toll?: boolean;
  has_highway?: boolean;
  has_ferry?: boolean;
};

type ValhallaRoute = {
  trip: {
    summary: ValhallaSummary;
    legs: {
      summary: ValhallaSummary;
      shape: string;
      maneuvers: {
        instruction: string;
        length: number;
        time: number;
        street_names?: string[];
      }[];
    }[];
  };
};

/**
 * Decode a Valhalla shape (Google's polyline algorithm at precision 6) into
 * GeoJSON-ordered [lon, lat] pairs.
 */
export const decodePolyline6 = (shape: string): [number, number][] => {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = shape.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < shape.length) {
    lat += next();
    lon += next();
    coordinates.push([lon / 1e6, lat / 1e6]);
  }
  return coordinates;
};

export type RouteOptions = {
  costing: Costing;
  language?: string;
  includeGeometry?: boolean;
};

/** A route through the locations in order. */
export const route = async (
  locations: Location[],
  { costing, language, includeGeometry = false }: RouteOptions
): Promise<Route> => {
  const response = await request(
    "Valhalla route",
    `${endpoints().valhalla}/route`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: locations.map(({ lat, lon }) => ({ lat, lon })),
        costing,
        units: "kilometers",
        ...(language ? { language } : {}),
      }),
    },
    jsonErrorDetail
  );
  const { trip } = (await response.json()) as ValhallaRoute;

  const result: Route = {
    costing,
    distanceKm: trip.summary.length,
    durationSeconds: Math.round(trip.summary.time),
    hasToll: trip.summary.has_toll ?? false,
    hasHighway: trip.summary.has_highway ?? false,
    hasFerry: trip.summary.has_ferry ?? false,
    legs: trip.legs.map((leg) => ({
      distanceKm: leg.summary.length,
      durationSeconds: Math.round(leg.summary.time),
      maneuvers: leg.maneuvers.map((m) => ({
        instruction: m.instruction,
        distanceKm: m.length,
        durationSeconds: Math.round(m.time),
        ...(m.street_names?.length ? { streetNames: m.street_names } : {}),
      })),
    })),
  };

  if (includeGeometry) {
    // Each leg starts where the previous one ended, so drop the repeated point.
    const coordinates = trip.legs.flatMap((leg, i) =>
      decodePolyline6(leg.shape).slice(i === 0 ? 0 : 1)
    );
    result.geometry = { type: "LineString", coordinates };
  }
  return result;
};

export type Isochrone = {
  costing: Costing;
  origin: LatLon;
  snappedTo: LatLon & { distanceM: number };
  contours: {
    value: number;
    unit: "minutes" | "km";
    geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown[] };
  }[];
};

type IsochroneFeature = {
  geometry: { type: string; coordinates: unknown };
  properties: { contour?: number; metric?: string; type?: string };
};

/**
 * The area reachable from origin within each of the given times or
 * distances.
 */
export const isochrone = async (
  origin: LatLon,
  { costing, minutes, km }: { costing: Costing; minutes?: number[]; km?: number[] }
): Promise<Isochrone> => {
  if ((minutes === undefined) === (km === undefined)) {
    throw new Error("Give exactly one of minutes or km");
  }
  const contours = minutes
    ? [...minutes].sort((a, b) => a - b).map((time) => ({ time }))
    : [...km!].sort((a, b) => a - b).map((distance) => ({ distance }));
  const response = await request(
    "Valhalla isochrone",
    `${endpoints().valhalla}/isochrone`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: [{ lat: origin.lat, lon: origin.lon }],
        costing,
        contours,
        polygons: true,
        // Valhalla answers with a tiny square instead of an error when the
        // origin is nowhere near a road; the snapped location tells them apart.
        show_locations: true,
      }),
    },
    jsonErrorDetail
  );
  const { features } = (await response.json()) as { features: IsochroneFeature[] };

  const snapped = features.find((f) => f.properties.type === "snapped")?.geometry
    .coordinates as [number, number][] | undefined;
  if (!snapped?.length) {
    throw new Error(`No road or path for ${costing} near ${origin.lat}, ${origin.lon}`);
  }
  const [lon, lat] = snapped[0];

  return {
    costing,
    origin: { lat: origin.lat, lon: origin.lon },
    snappedTo: { lat, lon, distanceM: distanceMetres(origin, { lat, lon }) },
    contours: features
      .filter((f) => f.properties.contour !== undefined)
      .map((f) => ({
        value: f.properties.contour!,
        unit: f.properties.metric === "distance" ? ("km" as const) : ("minutes" as const),
        geometry: f.geometry as Isochrone["contours"][number]["geometry"],
      }))
      .sort((a, b) => a.value - b.value),
  };
};
