import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userAgent } from "../src/lib/config.js";
import { describeTag, keyValues, searchKeys } from "../src/lib/taginfo.js";
import { mockFetch, mockFetchByPath, requestOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Real answers from a taginfo instance (data until 2026-01-29), trimmed.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/taginfo-${name}.json`, import.meta.url), "utf8"));

const api = "/api/4";

describe("searchKeys", () => {
  it("returns matching keys with their usage", async () => {
    mockFetch(fixture("keys-cuisine"));
    const result = await searchKeys("cuisine");
    expect(result.dataUntil).toBe("2026-01-29T00:59:50Z");
    expect(result.total).toBe(fixture("keys-cuisine").total);
    expect(result.keys[0]).toEqual({
      key: "cuisine",
      count: 1433692,
      nodes: 1124730,
      ways: 307162,
      relations: 1800,
      values: 77052,
    });
  });

  it("asks for the most used keys first", async () => {
    const fetchMock = mockFetch(fixture("keys-cuisine"));
    await searchKeys("cuisine", { limit: 3 });
    const { url, headers } = requestOf(fetchMock);
    expect(url.origin + url.pathname).toBe("https://taginfo.openstreetmap.org/api/4/keys/all");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "cuisine",
      page: "1",
      rp: "3",
      sortname: "count_all",
      sortorder: "desc",
    });
    expect(headers.get("User-Agent")).toBe(userAgent);
  });
});

describe("keyValues", () => {
  it("returns the values of a key, most used first", async () => {
    const fetchMock = mockFetch(fixture("values-cuisine-ramen"));
    const result = await keyValues("cuisine", { query: "ramen", limit: 3 });
    expect(result.key).toBe("cuisine");
    expect(result.values[0]).toEqual({ value: "ramen", count: 8213, fraction: 0.0057 });
    const { url } = requestOf(fetchMock);
    expect(url.pathname).toBe(`${api}/key/values`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      key: "cuisine",
      query: "ramen",
      page: "1",
      rp: "3",
      sortname: "count",
      sortorder: "desc",
    });
  });

  it("leaves the query out when there is none", async () => {
    const fetchMock = mockFetch(fixture("values-cuisine-ramen"));
    await keyValues("cuisine");
    expect(requestOf(fetchMock).url.searchParams.has("query")).toBe(false);
  });
});

describe("describeTag", () => {
  const cafe = {
    [`${api}/tag/stats`]: fixture("tag-stats-amenity-cafe"),
    [`${api}/tag/wiki_pages`]: fixture("tag-wiki-amenity-cafe"),
    [`${api}/tag/combinations`]: fixture("tag-combinations-amenity-cafe"),
  };

  it("counts the tag by element type", async () => {
    mockFetchByPath(cafe);
    const result = await describeTag("amenity", "cafe");
    expect(result).toMatchObject({
      key: "amenity",
      value: "cafe",
      count: { all: 618379, nodes: 533536, ways: 84264, relations: 579 },
    });
  });

  it("keeps the English wiki description, and the requested language", async () => {
    mockFetchByPath(cafe);
    const english = await describeTag("amenity", "cafe");
    expect(english.wiki.map((w) => w.lang)).toEqual(["en"]);
    expect(english.wiki[0]).toEqual({
      lang: "en",
      title: "Tag:amenity=cafe",
      description:
        "A generally informal place with sit-down facilities selling beverages and light meals and/or snacks.",
      status: "approved",
      usedOn: ["node", "area"],
    });

    mockFetchByPath(cafe);
    const japanese = await describeTag("amenity", "cafe", { language: "ja" });
    expect(japanese.wiki.map((w) => w.lang)).toEqual(["en", "ja"]);
    expect(japanese.wiki[1].description).toMatch(/^喫茶店/);
  });

  it("lists the tags most often used with it", async () => {
    mockFetchByPath(cafe);
    const { combinations } = await describeTag("amenity", "cafe");
    expect(combinations[0]).toEqual({ key: "name", value: null, count: 542553, fraction: 0.8774 });
    expect(combinations.map((c) => c.key)).toContain("cuisine");
  });

  it("asks for the tag in every request", async () => {
    const fetchMock = mockFetchByPath(cafe);
    await describeTag("amenity", "cafe");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url] of fetchMock.mock.calls) {
      const params = new URL(url).searchParams;
      expect(params.get("key")).toBe("amenity");
      expect(params.get("value")).toBe("cafe");
    }
  });

  it("describes a key on its own", async () => {
    const fetchMock = mockFetchByPath({
      [`${api}/key/stats`]: fixture("key-stats-cuisine"),
      [`${api}/key/wiki_pages`]: fixture("key-wiki-cuisine"),
      [`${api}/key/combinations`]: fixture("key-combinations-cuisine"),
    });
    const result = await describeTag("cuisine", undefined, { language: "ja" });
    expect(result).toMatchObject({
      key: "cuisine",
      value: null,
      count: { all: 1433692, nodes: 1124730, ways: 307162, relations: 1800 },
    });
    expect(result.wiki.map((w) => w.title)).toEqual(["Key:cuisine", "JA:Key:cuisine"]);
    expect(result.combinations[0]).toEqual({ key: "amenity", value: null, count: 1407910, fraction: 0.982 });
    for (const [url] of fetchMock.mock.calls) {
      expect(new URL(url).searchParams.has("value")).toBe(false);
    }
  });

  it("returns zero counts and no wiki for an unused tag", async () => {
    mockFetchByPath({
      [`${api}/tag/stats`]: {
        data_until: "2026-01-29T00:59:50Z",
        data: ["all", "nodes", "ways", "relations"].map((type) => ({ type, count: 0, count_fraction: 0 })),
      },
      [`${api}/tag/wiki_pages`]: { data: [] },
      [`${api}/tag/combinations`]: { total: 0, data: [] },
    });
    const result = await describeTag("nosuchkey", "foo");
    expect(result.count.all).toBe(0);
    expect(result.wiki).toEqual([]);
    expect(result.combinations).toEqual([]);
  });
});

describe("TAGINFO_URL", () => {
  it("points requests at a self-hosted taginfo", async () => {
    vi.stubEnv("TAGINFO_URL", "https://taginfo.example.org/");
    const fetchMock = mockFetch(fixture("keys-cuisine"));
    await searchKeys("cuisine");
    expect(requestOf(fetchMock).url.href).toMatch(/^https:\/\/taginfo\.example\.org\/api\/4\/keys\/all\?/);
  });
});

describe("errors", () => {
  it("puts taginfo's message in the error", async () => {
    mockFetch({ error: "number of results too large, use paging" }, { status: 412, statusText: "Precondition Failed" });
    await expect(keyValues("cuisine")).rejects.toThrow(
      "taginfo failed: 412 Precondition Failed\nnumber of results too large, use paging"
    );
  });
});
