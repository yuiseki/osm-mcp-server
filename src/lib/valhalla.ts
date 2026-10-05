import { endpoints } from "./config.js";
import { request } from "./http.js";

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

/** Valhalla explains a failed request in a JSON body. */
export const valhallaErrorDetail = (body: string): string => {
  try {
    const { error, error_code } = JSON.parse(body);
    if (typeof error === "string") {
      return error_code === undefined ? error : `${error} (error_code ${error_code})`;
    }
  } catch {
    // not JSON
  }
  return body;
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
    valhallaErrorDetail
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
