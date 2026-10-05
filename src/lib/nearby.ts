import { distanceMetres } from "./geo.js";
import { runOverpass, type OverpassElement } from "./overpass.js";

export type TagFilter = { key: string; value?: string | string[] };

export type NearbyOptions = {
  lat: number;
  lon: number;
  radiusM: number;
  tags: TagFilter[];
  name?: string;
  limit?: number;
};

export type NearbyPlace = {
  osmType: string;
  osmId: number;
  name: string | null;
  lat: number;
  lon: number;
  distanceM: number;
  tags: Record<string, string>;
};

export type NearbyResult = {
  timestampOsmBase: string | null;
  total: number;
  truncated: boolean;
  incomplete: boolean;
  results: NearbyPlace[];
};

// Overpass does not sort by distance, so fetch up to this many and sort here.
const fetchCap = 5000;

/** Quote text as an Overpass QL string, so input cannot end the string. */
const quote = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const tagFilter = ({ key, value }: TagFilter) => {
  if (value === undefined) return `[${quote(key)}]`;
  if (typeof value === "string") return `[${quote(key)}=${quote(value)}]`;
  return `[${quote(key)}~${quote(`^(${value.map(escapeRegex).join("|")})$`)}]`;
};

// name, name:en, brand, brand:en, ...: a chain is often named in the local
// language with the English name only in name:en or brand:en.
const nameKeys = "^(name|brand)(:.*)?$";

export const buildNearbyQuery = ({ lat, lon, radiusM, tags, name }: NearbyOptions) =>
  "[out:json][timeout:25];" +
  `nwr(around:${radiusM},${lat},${lon})` +
  tags.map(tagFilter).join("") +
  (name ? `[~${quote(nameKeys)}~${quote(escapeRegex(name))},i]` : "") +
  "->.r;.r out count;" +
  `.r out center tags ${fetchCap};`;

type Located = OverpassElement & {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/** Features with the given tags within radiusM of a point, nearest first. */
export const searchNearby = async (options: NearbyOptions): Promise<NearbyResult> => {
  const { limit = 20 } = options;
  const { timestampOsmBase, elements } = await runOverpass(buildNearbyQuery(options), {
    maxElements: fetchCap + 1,
  });
  const [count, ...features] = elements as Located[];
  const total = Number(count?.type === "count" ? count.tags?.total : features.length);

  const places = features
    .map((e): NearbyPlace | null => {
      const point = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
      if (!point) return null;
      return {
        osmType: e.type,
        osmId: e.id,
        name: e.tags?.name ?? null,
        lat: point.lat,
        lon: point.lon,
        distanceM: distanceMetres(options, point),
        tags: e.tags ?? {},
      };
    })
    .filter((p) => p !== null)
    .sort((a, b) => a.distanceM - b.distanceM);

  return {
    timestampOsmBase,
    total,
    truncated: places.length > limit,
    incomplete: total > features.length,
    results: places.slice(0, limit),
  };
};
