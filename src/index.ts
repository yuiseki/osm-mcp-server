#!/usr/bin/env node

/**
 * This is a MCP server that provides API access to the OpenStreetMap APIs.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { version } from "./lib/config.js";
import { reverseGeocode, searchPlaces } from "./lib/nominatim.js";
import { language, latitude, longitude, place } from "./lib/schemas.js";

const server = new McpServer({
  name: "osm-mcp-server",
  version,
});

// Every tool only reads from external OpenStreetMap services.
const annotations = { readOnlyHint: true, openWorldHint: true };

// structuredContent for clients that read it, and the same as JSON text for
// those that do not.
const result = <T extends Record<string, unknown>>(value: T) => ({
  structuredContent: value,
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

server.registerTool(
  "osm_geocoding",
  {
    title: "Geocode",
    description:
      "Find places by name or address with OpenStreetMap Nominatim. Returns several candidates, best match first, because names are often ambiguous; check displayName to pick the right one, or narrow the search with countrycodes.",
    inputSchema: {
      text: z.string().min(1).describe("The text to geocode (Address or place name)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("Maximum number of candidates"),
      countrycodes: z
        .array(z.string().length(2))
        .optional()
        .describe("Only return places in these countries (ISO 3166-1 alpha-2, e.g. ['jp'])"),
      language,
    },
    outputSchema: { results: z.array(place) },
    annotations,
  },
  async ({ text, limit, countrycodes, language }) =>
    result({
      results: await searchPlaces(text, { limit, countryCodes: countrycodes, language }),
    })
);

server.registerTool(
  "osm_reverse_geocoding",
  {
    title: "Reverse geocode",
    description:
      "Find the place and address at a coordinate with OpenStreetMap Nominatim.",
    inputSchema: {
      lat: latitude.describe("Latitude of the location to reverse geocode"),
      lon: longitude.describe("Longitude of the location to reverse geocode"),
      language,
    },
    outputSchema: place.extend({
      address: z
        .record(z.string(), z.string())
        .describe("Address parts, e.g. road, city, postcode, country_code"),
    }).shape,
    annotations,
  },
  async ({ lat, lon, language }) =>
    result(await reverseGeocode(lat, lon, { language }))
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
