import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startStubOsm } from "./stub-osm.js";

// Talks to the built bin over stdio, the way an MCP client does, with the
// OSM services replaced by a local stub so no network is needed.
const bin = fileURLToPath(new URL("../build/index.js", import.meta.url));

let client: Client;
let stub: Awaited<ReturnType<typeof startStubOsm>>;

beforeAll(async () => {
  if (!existsSync(bin)) {
    throw new Error(`${bin} not found; run npm run build first`);
  }
  stub = await startStubOsm();
  client = new Client({ name: "osm-mcp-server-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [bin],
      env: { PATH: process.env.PATH ?? "", ...stub.env },
    })
  );
});

afterAll(async () => {
  await client?.close();
  await stub?.close();
});

beforeEach(() => {
  stub.routes.clear();
  stub.requests.length = 0;
});

type Text = { type: string; text: string };

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as Text[];
  return { result, text: content.text };
};

// Tool errors come back as results with isError, so the model can read
// them and retry, rather than as protocol errors.
const errorText = async (name: string, args: Record<string, unknown>) => {
  const { result, text } = await call(name, args);
  expect(result.isError).toBe(true);
  return text;
};

// Every successful tool returns structuredContent plus the same thing as JSON
// text, for clients that do not read structuredContent.
const structured = async (name: string, args: Record<string, unknown>) => {
  const { result, text } = await call(name, args);
  expect(result.isError, text).toBeFalsy();
  expect(JSON.parse(text)).toEqual(result.structuredContent);
  return result.structuredContent as Record<string, any>;
};

const fuchu = {
  name: "府中",
  display_name: "府中, 府中市, 東京都, 日本",
  lat: "35.672219",
  lon: "139.4800091",
  osm_type: "node",
  osm_id: 7682981674,
  category: "railway",
  type: "station",
  boundingbox: ["35.667219", "35.677219", "139.4750091", "139.4850091"],
};

describe("osm-mcp-server over stdio", () => {
  it("identifies itself", () => {
    expect(client.getServerVersion()?.name).toBe("osm-mcp-server");
  });

  it("lists the tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "osm_geocoding",
      "osm_reverse_geocoding",
    ]);
  });

  it("marks every tool as read-only and declares its output", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it("reports an unknown tool as a tool error", async () => {
    expect(await errorText("no_such_tool", {})).toMatch(/no_such_tool not found/);
  });
});

describe("osm_geocoding", () => {
  it("returns every candidate", async () => {
    stub.routes.set("/nominatim/search", () => ({
      body: [fuchu, { ...fuchu, name: "府中", osm_id: 2, display_name: "府中, 板橋區, 新北市, 臺灣" }],
    }));
    const { results } = await structured("osm_geocoding", { text: "府中" });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: "府中", lat: 35.672219, osmId: 7682981674 });
    expect(results[1].displayName).toContain("臺灣");
  });

  it("passes limit, countrycodes and language through", async () => {
    stub.routes.set("/nominatim/search", () => ({ body: [] }));
    await structured("osm_geocoding", {
      text: "府中",
      limit: 3,
      countrycodes: ["jp"],
      language: "ja",
    });
    const [req] = stub.requests;
    expect(req.query.get("limit")).toBe("3");
    expect(req.query.get("countrycodes")).toBe("jp");
    expect(req.query.get("accept-language")).toBe("ja");
    expect(req.headers["user-agent"]).toMatch(/^osm-mcp-server\//);
  });

  it("asks for 5 candidates by default", async () => {
    stub.routes.set("/nominatim/search", () => ({ body: [] }));
    await structured("osm_geocoding", { text: "府中" });
    expect(stub.requests[0].query.get("limit")).toBe("5");
  });

  it("returns an empty list when nothing matches", async () => {
    stub.routes.set("/nominatim/search", () => ({ body: [] }));
    expect(await structured("osm_geocoding", { text: "nowhere" })).toEqual({ results: [] });
  });

  it("reports a missing text as a tool error", async () => {
    expect(await errorText("osm_geocoding", {})).toMatch(/text/);
  });

  it("reports a limit over 20 as a tool error", async () => {
    expect(await errorText("osm_geocoding", { text: "x", limit: 50 })).toMatch(/limit/);
  });

  it("reports an HTTP failure as a tool error", async () => {
    stub.routes.set("/nominatim/search", () => ({ status: 503, body: "busy" }));
    expect(await errorText("osm_geocoding", { text: "x" })).toMatch(
      /Nominatim search failed: 503/
    );
  });
});

describe("osm_reverse_geocoding", () => {
  it("returns the place with its address", async () => {
    stub.routes.set("/nominatim/reverse", () => ({
      body: { ...fuchu, address: { railway: "府中", city: "府中市", country_code: "jp" } },
    }));
    const place = await structured("osm_reverse_geocoding", { lat: 35.6722, lon: 139.48 });
    expect(place).toMatchObject({
      name: "府中",
      lat: 35.672219,
      address: { city: "府中市", country_code: "jp" },
    });
    expect(stub.requests[0].query.get("lat")).toBe("35.6722");
  });

  it("reports non-numeric coordinates as a tool error", async () => {
    expect(
      await errorText("osm_reverse_geocoding", { lat: "35.6", lon: 139.7 })
    ).toMatch(/lat/);
  });

  it("reports out-of-range coordinates as a tool error", async () => {
    expect(await errorText("osm_reverse_geocoding", { lat: 95, lon: 0 })).toMatch(/lat/);
  });

  it("reports an empty spot as a tool error", async () => {
    stub.routes.set("/nominatim/reverse", () => ({ body: { error: "Unable to geocode" } }));
    expect(await errorText("osm_reverse_geocoding", { lat: 0, lon: -140 })).toMatch(
      /Unable to geocode/
    );
  });
});
