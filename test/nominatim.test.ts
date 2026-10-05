import { afterEach, describe, expect, it, vi } from "vitest";
import { userAgent } from "../src/lib/config.js";
import { reverseGeocode, searchPlaces } from "../src/lib/nominatim.js";
import { mockFetch, requestOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const fuchuTokyo = {
  name: "府中",
  display_name: "府中, 府中駅前通り, 宮町一丁目, 府中市, 東京都, 183-0056, 日本",
  lat: "35.6722190",
  lon: "139.4800091",
  osm_type: "node",
  osm_id: 7682981674,
  category: "railway",
  type: "station",
  boundingbox: ["35.6672190", "35.6772190", "139.4750091", "139.4850091"],
};

const tokyoTower = {
  osm_type: "relation",
  osm_id: 4247312,
  lat: "35.6584491",
  lon: "139.7455360",
  category: "tourism",
  type: "attraction",
  name: "Tokyo Tower",
  display_name: "Tokyo Tower, Tokyo Tower Street, Shibakōen 4, Minato, Tokyo, 106-0041, Japan",
  address: {
    tourism: "Tokyo Tower",
    road: "Tokyo Tower Street",
    city: "Minato",
    "ISO3166-2-lvl4": "JP-13",
    postcode: "106-0041",
    country: "Japan",
    country_code: "jp",
  },
  boundingbox: ["35.6581782", "35.6589495", "139.7449463", "139.7459337"],
};

describe("searchPlaces", () => {
  it("returns every candidate in a normalised shape", async () => {
    mockFetch([fuchuTokyo, { ...fuchuTokyo, osm_id: 1, name: "" }]);
    const places = await searchPlaces("府中");
    expect(places).toHaveLength(2);
    expect(places[0]).toEqual({
      name: "府中",
      displayName: "府中, 府中駅前通り, 宮町一丁目, 府中市, 東京都, 183-0056, 日本",
      lat: 35.672219,
      lon: 139.4800091,
      osmType: "node",
      osmId: 7682981674,
      category: "railway",
      type: "station",
      boundingBox: { south: 35.667219, north: 35.677219, west: 139.4750091, east: 139.4850091 },
    });
    expect(places[1].name).toBeNull();
  });

  it("returns an empty list when nothing matches", async () => {
    mockFetch([]);
    await expect(searchPlaces("nowhere")).resolves.toEqual([]);
  });

  it("sends the query and options to the search endpoint", async () => {
    const fetchMock = mockFetch([]);
    await searchPlaces("東京タワー & 芝公園", {
      limit: 3,
      countryCodes: ["jp", "tw"],
      language: "en",
    });
    const { url, headers } = requestOf(fetchMock);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: "jsonv2",
      q: "東京タワー & 芝公園",
      limit: "3",
      countrycodes: "jp,tw",
      "accept-language": "en",
    });
    expect(headers.get("User-Agent")).toBe(userAgent);
  });

  it("leaves unset options out of the request", async () => {
    const fetchMock = mockFetch([]);
    await searchPlaces("Tokyo Tower");
    expect(Object.fromEntries(requestOf(fetchMock).url.searchParams)).toEqual({
      format: "jsonv2",
      q: "Tokyo Tower",
    });
  });

  it("throws with the status on an HTTP error", async () => {
    mockFetch({}, { status: 403, statusText: "Forbidden" });
    await expect(searchPlaces("Tokyo Tower")).rejects.toThrow(
      "Nominatim search failed: 403 Forbidden"
    );
  });
});

describe("reverseGeocode", () => {
  it("returns the place with its address", async () => {
    mockFetch(tokyoTower);
    await expect(reverseGeocode(35.6586, 139.7454)).resolves.toEqual({
      name: "Tokyo Tower",
      displayName: "Tokyo Tower, Tokyo Tower Street, Shibakōen 4, Minato, Tokyo, 106-0041, Japan",
      lat: 35.6584491,
      lon: 139.745536,
      osmType: "relation",
      osmId: 4247312,
      category: "tourism",
      type: "attraction",
      boundingBox: { south: 35.6581782, north: 35.6589495, west: 139.7449463, east: 139.7459337 },
      address: tokyoTower.address,
    });
  });

  it("sends the coordinates and language to the reverse endpoint", async () => {
    const fetchMock = mockFetch(tokyoTower);
    await reverseGeocode(35.6586, 139.7454, { language: "en" });
    const { url, headers } = requestOf(fetchMock);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/reverse");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: "jsonv2",
      lat: "35.6586",
      lon: "139.7454",
      "accept-language": "en",
    });
    expect(headers.get("User-Agent")).toBe(userAgent);
  });

  it("throws Nominatim's message when nothing is there", async () => {
    mockFetch({ error: "Unable to geocode" });
    await expect(reverseGeocode(0, -140)).rejects.toThrow(
      "Nothing found at 0, -140: Unable to geocode"
    );
  });

  it("throws with the status on an HTTP error", async () => {
    mockFetch({}, { status: 403, statusText: "Forbidden" });
    await expect(reverseGeocode(0, 0)).rejects.toThrow(
      "Nominatim reverse failed: 403 Forbidden"
    );
  });
});

describe("NOMINATIM_URL", () => {
  it("points both requests at a self-hosted Nominatim", async () => {
    vi.stubEnv("NOMINATIM_URL", "https://nominatim.example.org/");
    const search = mockFetch([]);
    await searchPlaces("Tokyo Tower");
    expect(requestOf(search).url.href).toMatch(/^https:\/\/nominatim\.example\.org\/search\?/);

    const reverse = mockFetch(tokyoTower);
    await reverseGeocode(0, 0);
    expect(requestOf(reverse).url.href).toMatch(/^https:\/\/nominatim\.example\.org\/reverse\?/);
  });
});
