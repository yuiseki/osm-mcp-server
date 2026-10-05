import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Talks to the built bin over stdio, the way an MCP client does.
// Only covers what needs no network, so it can run in CI.
const bin = fileURLToPath(new URL("../build/index.js", import.meta.url));

let client: Client;

beforeAll(async () => {
  if (!existsSync(bin)) {
    throw new Error(`${bin} not found; run npm run build first`);
  }
  client = new Client({ name: "osm-mcp-server-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: bin }));
});

afterAll(async () => {
  await client?.close();
});

describe("osm-mcp-server over stdio", () => {
  it("identifies itself", () => {
    expect(client.getServerVersion()?.name).toBe("osm-mcp-server");
  });

  it("lists the geocoding tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "osm_geocoding",
      "osm_reverse_geocoding",
    ]);
    const reverse = tools.find((t) => t.name === "osm_reverse_geocoding");
    expect(reverse?.inputSchema.required).toEqual(["lat", "lon"]);
  });

  it("rejects osm_geocoding without text", async () => {
    await expect(
      client.callTool({ name: "osm_geocoding", arguments: {} })
    ).rejects.toThrow("'text' is required");
  });

  it("rejects osm_reverse_geocoding with non-numeric coordinates", async () => {
    await expect(
      client.callTool({
        name: "osm_reverse_geocoding",
        arguments: { lat: "35.6", lon: 139.7 },
      })
    ).rejects.toThrow("'lat' and 'lon' are required");
  });

  it("rejects an unknown tool", async () => {
    await expect(
      client.callTool({ name: "no_such_tool", arguments: {} })
    ).rejects.toThrow("Unknown tool: no_such_tool");
  });
});
