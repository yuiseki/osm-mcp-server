#!/user/bin/env node

/**
 * This is a MCP server that provides API access to the OpenStreetMap APIs.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { geocodeNominatim, reverseGeocodeNominatim } from "./lib/nominatim.js";

const server = new Server(
  {
    name: "osm-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "osm_geocoding",
        description:
          "Geocoding tool that uses the OpenStreetMap Nominatim API.",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The text to geocode (Address or place name)",
            },
          },
          required: ["text"],
        },
      },
      {
        name: "osm_reverse_geocoding",
        description:
          "Reverse geocoding tool that uses the OpenStreetMap Nominatim API.",
        inputSchema: {
          type: "object",
          properties: {
            lat: {
              type: "number",
              description: "Latitude of the location to reverse geocode",
            },
            lon: {
              type: "number",
              description: "Longitude of the location to reverse geocode",
            },
          },
          required: ["lat", "lon"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "osm_geocoding": {
      if (
        !request.params.arguments ||
        typeof request.params.arguments.text !== "string"
      ) {
        throw new Error(
          "Invalid arguments: 'text' is required and must be a string."
        );
      }

      const text = request.params.arguments.text;
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
    case "osm_reverse_geocoding": {
      if (
        !request.params.arguments ||
        typeof request.params.arguments.lat !== "number" ||
        typeof request.params.arguments.lon !== "number"
      ) {
        throw new Error(
          "Invalid arguments: 'lat' and 'lon' are required and must be numbers."
        );
      }

      const { lat, lon } = request.params.arguments;
      const { displayName } = await reverseGeocodeNominatim(lat, lon);

      return {
        content: [
          {
            type: "text",
            text: displayName,
          },
        ],
      };
    }
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

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
