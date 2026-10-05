import { endpoints } from "./config.js";
import { request } from "./http.js";

export type BoundingBox = {
  south: number;
  north: number;
  west: number;
  east: number;
};

export type Place = {
  name: string | null;
  displayName: string;
  lat: number;
  lon: number;
  osmType: string;
  osmId: number;
  category: string;
  type: string;
  boundingBox: BoundingBox;
};

export type ReversePlace = Place & {
  address: Record<string, string>;
};

type NominatimPlace = {
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
  osm_type: string;
  osm_id: number;
  category: string;
  type: string;
  boundingbox: [string, string, string, string];
  address?: Record<string, string>;
};

const toPlace = (p: NominatimPlace): Place => {
  const [south, north, west, east] = p.boundingbox.map(Number);
  return {
    name: p.name || null,
    displayName: p.display_name,
    lat: Number(p.lat),
    lon: Number(p.lon),
    osmType: p.osm_type,
    osmId: p.osm_id,
    category: p.category,
    type: p.type,
    boundingBox: { south, north, west, east },
  };
};

const url = (path: string, params: Record<string, string | undefined>) => {
  const search = new URLSearchParams({ format: "jsonv2" });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  return `${endpoints().nominatim}/${path}?${search}`;
};

export type SearchOptions = {
  limit?: number;
  countryCodes?: string[];
  language?: string;
};

/** Places matching a free-text query, best match first. */
export const searchPlaces = async (
  query: string,
  { limit, countryCodes, language }: SearchOptions = {}
): Promise<Place[]> => {
  const response = await request(
    "Nominatim search",
    url("search", {
      q: query,
      limit: limit?.toString(),
      countrycodes: countryCodes?.length ? countryCodes.join(",") : undefined,
      "accept-language": language,
    })
  );
  const places = (await response.json()) as NominatimPlace[];
  return places.map(toPlace);
};

/** The place at a coordinate, with its address broken down. */
export const reverseGeocode = async (
  lat: number,
  lon: number,
  { language }: { language?: string } = {}
): Promise<ReversePlace> => {
  const response = await request(
    "Nominatim reverse",
    url("reverse", {
      lat: lat.toString(),
      lon: lon.toString(),
      "accept-language": language,
    })
  );
  const place = (await response.json()) as NominatimPlace | { error: string };
  if ("error" in place) {
    throw new Error(`Nothing found at ${lat}, ${lon}: ${place.error}`);
  }
  return { ...toPlace(place), address: place.address ?? {} };
};
