import { afterEach, describe, expect, it, vi } from "vitest";
import { userAgent } from "../src/lib/config.js";
import { overpassErrorDetail, runOverpass, withJsonOutput } from "../src/lib/overpass.js";
import { mockFetch, requestOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const response = (elements: unknown[], remark?: string) => ({
  version: 0.6,
  osm3s: { timestamp_osm_base: "2025-09-14T23:59:55Z" },
  elements,
  ...(remark ? { remark } : {}),
});

const cafe = (id: number) => ({
  type: "node",
  id,
  lat: 35.6597024,
  lon: 139.7432472,
  tags: { amenity: "cafe", name: `Cafe ${id}` },
});

describe("withJsonOutput", () => {
  it("adds [out:json] as its own statement when there are no settings", () => {
    expect(withJsonOutput("node(1);out;")).toBe("[out:json];node(1);out;");
  });

  // Overpass reports errors by line number, which has to match the query the
  // model wrote.
  it("keeps the line numbers of the query", () => {
    expect(withJsonOutput("node(1);\nout;").split("\n")).toHaveLength(2);
    expect(withJsonOutput("[timeout:25];\nnode(1);\nout;").split("\n")).toHaveLength(3);
  });

  it("stacks [out:json] onto existing settings", () => {
    expect(withJsonOutput("  [timeout:25];node(1);out;")).toBe(
      "[out:json][timeout:25];node(1);out;"
    );
  });

  it("leaves a query that already asks for JSON alone", () => {
    expect(withJsonOutput("[out:json][timeout:25];node(1);out;")).toBe(
      "[out:json][timeout:25];node(1);out;"
    );
  });

  it("rejects other output formats", () => {
    expect(() => withJsonOutput("[out:xml];node(1);out;")).toThrow(
      "Only JSON output is supported"
    );
    expect(() => withJsonOutput('[out:csv(name)];node(1);out;')).toThrow(
      "Only JSON output is supported"
    );
  });
});

describe("overpassErrorDetail", () => {
  it("keeps only Overpass's error lines from the HTML page", () => {
    const html = `<html><head><script>noise()</script></head><body>
<p>The data included in this document is from www.openstreetmap.org.</p>
<p><strong style="color:#FF0000">Error</strong>: line 1: parse error: ']' expected - ';' found. </p>
<p><strong style="color:#FF0000">Error</strong>: line 1: parse error: Unexpected end of input. </p>
</body></html>`;
    expect(overpassErrorDetail(html)).toBe(
      "line 1: parse error: ']' expected - ';' found.\nline 1: parse error: Unexpected end of input."
    );
  });

  it("decodes HTML entities", () => {
    expect(
      overpassErrorDetail(
        '<p><strong>Error</strong>: line 2: static error: Unknown type &quot;nod&quot; &lt;x&gt; &amp; y</p>'
      )
    ).toBe('line 2: static error: Unknown type "nod" <x> & y');
  });

  it("falls back to the text of the page", () => {
    expect(overpassErrorDetail("<html><body><p>Too   many\nrequests</p></body></html>")).toBe(
      "Too many requests"
    );
  });
});

describe("runOverpass", () => {
  it("posts the query with [out:json] to the interpreter", async () => {
    const fetchMock = mockFetch(response([]));
    await runOverpass("node(1);out;");
    const { url, method, headers, body } = requestOf(fetchMock);
    expect(url.href).toBe("https://overpass-api.de/api/interpreter");
    expect(method).toBe("POST");
    expect(headers.get("User-Agent")).toBe(userAgent);
    expect(new URLSearchParams(String(body)).get("data")).toBe("[out:json];node(1);out;");
  });

  it("returns the elements and the data timestamp", async () => {
    mockFetch(response([cafe(1), cafe(2)]));
    await expect(runOverpass("node(1);out;")).resolves.toEqual({
      timestampOsmBase: "2025-09-14T23:59:55Z",
      totalElements: 2,
      truncated: false,
      elements: [cafe(1), cafe(2)],
    });
  });

  it("truncates to maxElements and says so", async () => {
    mockFetch(response([cafe(1), cafe(2), cafe(3)]));
    const result = await runOverpass("node(1);out;", { maxElements: 2 });
    expect(result.totalElements).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.elements.map((e) => e.id)).toEqual([1, 2]);
  });

  it("throws on a runtime error instead of returning an empty result", async () => {
    mockFetch(response([], 'runtime error: Query timed out in "query" at line 1 after 2 seconds.'));
    await expect(runOverpass("nwr[amenity];out;")).rejects.toThrow(
      'Overpass runtime error: Query timed out in "query" at line 1 after 2 seconds.'
    );
  });

  it("puts Overpass's parse errors in the thrown error", async () => {
    mockFetch(
      '<html><p><strong style="color:#FF0000">Error</strong>: line 1: parse error: Unexpected end of input. </p></html>',
      { status: 400, statusText: "Bad Request" }
    );
    await expect(runOverpass("node(1")).rejects.toThrow(
      "Overpass failed: 400 Bad Request\nline 1: parse error: Unexpected end of input."
    );
  });

  it("uses OVERPASS_URL", async () => {
    vi.stubEnv("OVERPASS_URL", "https://overpass.example.org/api/");
    const fetchMock = mockFetch(response([]));
    await runOverpass("node(1);out;");
    expect(requestOf(fetchMock).url.href).toBe("https://overpass.example.org/api/interpreter");
  });
});
