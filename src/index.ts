#!/usr/bin/env node

/**
 * This is a MCP server that provides API access to the OpenStreetMap APIs.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { version } from "./lib/config.js";
import { geocodeNominatim, reverseGeocodeNominatim } from "./lib/nominatim.js";

const server = new McpServer({
  name: "osm-mcp-server",
  version,
});

// Every tool only reads from external OpenStreetMap services.
const annotations = { readOnlyHint: true, openWorldHint: true };

server.registerTool(
  "osm_geocoding",
  {
    title: "Geocode",
    description: "Geocoding tool that uses the OpenStreetMap Nominatim API.",
    inputSchema: {
      text: z
        .string()
        .describe("The text to geocode (Address or place name)"),
    },
    annotations,
  },
  async ({ text }) => {
    const { lat, lon } = await geocodeNominatim(text);
    return {
      content: [
        {
          type: "text",
          text: `The geocoded location is at latitude ${lat} and longitude ${lon}.`,
        },
      ],
    };
  }
);

server.registerTool(
  "osm_reverse_geocoding",
  {
    title: "Reverse geocode",
    description:
      "Reverse geocoding tool that uses the OpenStreetMap Nominatim API.",
    inputSchema: {
      lat: z.number().describe("Latitude of the location to reverse geocode"),
      lon: z.number().describe("Longitude of the location to reverse geocode"),
    },
    annotations,
  },
  async ({ lat, lon }) => {
    const { displayName } = await reverseGeocodeNominatim(lat, lon);
    return {
      content: [{ type: "text", text: displayName }],
    };
  }
);

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
