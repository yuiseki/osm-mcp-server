import { afterEach, describe, expect, it, vi } from "vitest";
import {
  geocodeNominatim,
  reverseGeocodeNominatim,
} from "../src/lib/nominatim.js";
import { userAgent } from "../src/lib/config.js";

const mockFetch = (body: unknown, init: { status?: number; statusText?: string } = {}) => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      statusText: init.statusText ?? "OK",
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const requestOf = (fetchMock: ReturnType<typeof mockFetch>) => {
  const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url: new URL(url), headers: new Headers(options?.headers) };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("NOMINATIM_URL", () => {
  it("points both requests at a self-hosted Nominatim", async () => {
    vi.stubEnv("NOMINATIM_URL", "https://nominatim.example.org/");
    const search = mockFetch([{ lat: "0", lon: "0" }]);
    await geocodeNominatim("Tokyo Tower");
    expect(requestOf(search).url.href).toMatch(/^https:\/\/nominatim\.example\.org\/search\?/);

    const reverse = mockFetch({ display_name: "x", address: {} });
    await reverseGeocodeNominatim(0, 0);
    expect(requestOf(reverse).url.href).toMatch(/^https:\/\/nominatim\.example\.org\/reverse\?/);
  });
});

describe("geocodeNominatim", () => {
  it("returns the first result as numbers", async () => {
    mockFetch([
      { lat: "35.6584491", lon: "139.745536" },
      { lat: "0", lon: "0" },
    ]);
    await expect(geocodeNominatim("Tokyo Tower")).resolves.toEqual({
      lat: 35.6584491,
      lon: 139.745536,
    });
  });

  it("sends the query to the search endpoint", async () => {
    const fetchMock = mockFetch([{ lat: "0", lon: "0" }]);
    await geocodeNominatim("東京タワー & 芝公園");
    const { url } = requestOf(fetchMock);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("q")).toBe("東京タワー & 芝公園");
  });

  it("sends an identifying User-Agent", async () => {
    const fetchMock = mockFetch([{ lat: "0", lon: "0" }]);
    await geocodeNominatim("Tokyo Tower");
    expect(requestOf(fetchMock).headers.get("User-Agent")).toBe(userAgent);
  });

  it("throws when nothing is found", async () => {
    mockFetch([]);
    await expect(geocodeNominatim("nowhere")).rejects.toThrow("No results found");
  });

  it("throws with the status text on an HTTP error", async () => {
    mockFetch({}, { status: 403, statusText: "Forbidden" });
    await expect(geocodeNominatim("Tokyo Tower")).rejects.toThrow(
      "Error fetching geocode data: Forbidden"
    );
  });
});

describe("reverseGeocodeNominatim", () => {
  it("returns the display name", async () => {
    mockFetch({
      display_name: "東京タワー通り, 芝公園四丁目, 港区, 東京都",
      address: { road: "東京タワー通り" },
    });
    await expect(reverseGeocodeNominatim(35.6586, 139.7454)).resolves.toEqual({
      displayName: "東京タワー通り, 芝公園四丁目, 港区, 東京都",
    });
  });

  it("sends the coordinates to the reverse endpoint", async () => {
    const fetchMock = mockFetch({ display_name: "x", address: {} });
    await reverseGeocodeNominatim(35.6586, 139.7454);
    const { url } = requestOf(fetchMock);
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/reverse");
    expect(url.searchParams.get("lat")).toBe("35.6586");
    expect(url.searchParams.get("lon")).toBe("139.7454");
  });

  it("sends an identifying User-Agent", async () => {
    const fetchMock = mockFetch({ display_name: "x", address: {} });
    await reverseGeocodeNominatim(0, 0);
    expect(requestOf(fetchMock).headers.get("User-Agent")).toBe(userAgent);
  });

  it("throws when no address is returned", async () => {
    mockFetch({ error: "Unable to geocode" });
    await expect(reverseGeocodeNominatim(0, 0)).rejects.toThrow("No address found");
  });

  it("throws with the status text on an HTTP error", async () => {
    mockFetch({}, { status: 403, statusText: "Forbidden" });
    await expect(reverseGeocodeNominatim(0, 0)).rejects.toThrow(
      "Error fetching reverse geocode data: Forbidden"
    );
  });
});
