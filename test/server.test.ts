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

  // Tool errors come back as results with isError, so the model can read
  // them and retry, rather than as protocol errors.
  const errorText = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    const [content] = result.content as { type: string; text: string }[];
    return content.text;
  };

  it("reports osm_geocoding without text as a tool error", async () => {
    expect(await errorText("osm_geocoding", {})).toMatch(/text/);
  });

  it("reports non-numeric coordinates as a tool error", async () => {
    expect(
      await errorText("osm_reverse_geocoding", { lat: "35.6", lon: 139.7 })
    ).toMatch(/lat/);
  });

  it("reports an unknown tool as a tool error", async () => {
    expect(await errorText("no_such_tool", {})).toMatch(/no_such_tool not found/);
  });

  it("marks every tool as read-only", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
  });
});
