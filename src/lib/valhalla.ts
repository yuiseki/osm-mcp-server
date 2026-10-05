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

type ValhallaTrip = ValhallaRoute["trip"];

const post = async (label: string, path: string, body: unknown) =>
  request(
    label,
    `${endpoints().valhalla}/${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    jsonErrorDetail
  );

const routeRequest = (locations: Location[], { costing, language }: RouteOptions) => ({
  locations: locations.map(({ lat, lon }) => ({ lat, lon })),
  costing,
  units: "kilometers",
  ...(language ? { language } : {}),
});

const toRoute = (trip: ValhallaTrip, costing: Costing, includeGeometry: boolean): Route => {
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

/** A route through the locations in order. */
export const route = async (locations: Location[], options: RouteOptions): Promise<Route> => {
  const response = await post("Valhalla route", "route", routeRequest(locations, options));
  const { trip } = (await response.json()) as ValhallaRoute;
  return toRoute(trip, options.costing, options.includeGeometry ?? false);
};

/**
 * A route that keeps the first and last locations and visits the others in
 * the order that takes the least time. order lists the original indexes in
 * the order they are visited.
 */
export const optimizedRoute = async (
  locations: Location[],
  options: RouteOptions
): Promise<Route & { order: number[] }> => {
  const response = await post("Valhalla optimized_route", "optimized_route", routeRequest(locations, options));
  const { trip } = (await response.json()) as {
    trip: ValhallaTrip & { locations: { original_index: number }[] };
  };
  return {
    order: trip.locations.map((l) => l.original_index),
    ...toRoute(trip, options.costing, options.includeGeometry ?? false),
  };
};

export type SnappedLocation = LatLon & { snappedTo: LatLon & { distanceM: number } };

export type RouteMatrix = {
  costing: Costing;
  sources: SnappedLocation[];
  targets: SnappedLocation[];
  matrix: ({ durationSeconds: number; distanceKm: number } | null)[][];
};

const snapped = (input: LatLon, placed: LatLon): SnappedLocation => ({
  lat: input.lat,
  lon: input.lon,
  snappedTo: {
    lat: placed.lat,
    lon: placed.lon,
    distanceM: distanceMetres(input, placed),
  },
});

/** Travel time and distance from every source to every target. */
export const routeMatrix = async (
  sources: LatLon[],
  targets: LatLon[],
  { costing }: { costing: Costing }
): Promise<RouteMatrix> => {
  const plain = (l: LatLon) => ({ lat: l.lat, lon: l.lon });
  const response = await post("Valhalla sources_to_targets", "sources_to_targets", {
    sources: sources.map(plain),
    targets: targets.map(plain),
    costing,
    units: "kilometers",
  });
  const data = (await response.json()) as {
    sources: LatLon[];
    targets: LatLon[];
    sources_to_targets: { time: number | null; distance: number | null }[][];
  };
  return {
    costing,
    sources: sources.map((s, i) => snapped(s, data.sources[i])),
    targets: targets.map((t, i) => snapped(t, data.targets[i])),
    matrix: data.sources_to_targets.map((row) =>
      row.map((cell) =>
        cell.time === null || cell.distance === null
          ? null
          : { durationSeconds: Math.round(cell.time), distanceKm: cell.distance }
      )
    ),
  };
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
  const response = await post("Valhalla isochrone", "isochrone", {
    locations: [{ lat: origin.lat, lon: origin.lon }],
    costing,
    contours,
    polygons: true,
    // Valhalla answers with a tiny square instead of an error when the
    // origin is nowhere near a road; the snapped location tells them apart.
    show_locations: true,
  });
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
