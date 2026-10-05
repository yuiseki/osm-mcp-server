#!/usr/bin/env node

/**
 * This is a MCP server that provides API access to the OpenStreetMap APIs.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { version } from "./lib/config.js";
import { reverseGeocode, searchPlaces } from "./lib/nominatim.js";
import { searchNearby } from "./lib/nearby.js";
import { runOverpass } from "./lib/overpass.js";
import { describeTag, keyValues, searchKeys } from "./lib/taginfo.js";
import { costings, route } from "./lib/valhalla.js";
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

server.registerTool(
  "osm_overpass_query",
  {
    title: "Overpass query",
    description: [
      "Run an Overpass QL query against OpenStreetMap data and return the matching elements as JSON.",
      "Use it to find features by tag in an area, e.g. cafes within 500 m of a point:",
      "  nwr(around:500,35.6586,139.7454)[amenity=cafe]; out center;",
      "Tips: always limit the area with around:, a bbox (south,west,north,east) or an area found by name;",
      "use 'out center;' to get one coordinate for ways and relations; use 'out count;' to only count;",
      "add [timeout:N] for heavy queries. [out:json] is added for you; other output formats are not supported.",
      "If you are not sure which tag mappers use for something, check with osm_taginfo_values or osm_taginfo_tag first.",
      "Coordinates are latitude first. The result says when the data was last updated (timestampOsmBase).",
    ].join("\n"),
    inputSchema: {
      query: z.string().min(1).describe("Overpass QL query"),
      max_elements: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100)
        .describe("Maximum number of elements to return; the rest are dropped and truncated is set"),
    },
    outputSchema: {
      timestampOsmBase: z
        .string()
        .nullable()
        .describe("When the OSM data behind the answer was last updated"),
      totalElements: z.number().describe("Number of elements the query matched"),
      truncated: z.boolean().describe("True when elements were dropped to fit max_elements"),
      elements: z
        .array(z.looseObject({ type: z.string(), id: z.number() }))
        .describe("OSM elements as returned by Overpass (type, id, tags, lat/lon or center, ...)"),
    },
    annotations,
  },
  async ({ query, max_elements }) =>
    result(await runOverpass(query, { maxElements: max_elements }))
);

server.registerTool(
  "osm_search_nearby",
  {
    title: "Search nearby",
    description: [
      "Find OpenStreetMap features with given tags around a point, nearest first, without writing Overpass QL.",
      "Example: ramen shops within 500 m are tags [{key: 'amenity', value: 'restaurant'}, {key: 'cuisine', value: 'ramen'}].",
      "Every tag must match. If you are not sure which tags mappers use, check with osm_taginfo_values or osm_taginfo_tag first.",
      "Use osm_geocoding first to turn a place name into coordinates.",
    ].join("\n"),
    inputSchema: {
      lat: latitude.describe("Latitude of the centre"),
      lon: longitude.describe("Longitude of the centre"),
      radius_m: z.number().int().min(1).max(10000).default(500).describe("Search radius in metres"),
      tags: z
        .array(
          z.object({
            key: z.string().min(1).describe("Tag key, e.g. amenity"),
            value: z
              .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
              .optional()
              .describe("Tag value, or several of which any may match; leave out to match any value"),
          })
        )
        .min(1)
        .max(5)
        .describe("Tags that every result must have"),
      name: z.string().min(1).optional().describe("Only features whose name or brand, in any language (name, name:en, brand, ...), contains this text; case-insensitive"),
      limit: z.number().int().min(1).max(200).default(20).describe("Maximum number of results"),
    },
    outputSchema: {
      timestampOsmBase: z.string().nullable().describe("When the OSM data was last updated"),
      total: z.number().describe("Number of features that matched"),
      truncated: z.boolean().describe("True when more matched than limit"),
      incomplete: z
        .boolean()
        .describe("True when too many matched to sort them all; the results may miss nearer ones, so search a smaller radius"),
      results: z.array(
        z.object({
          osmType: z.string(),
          osmId: z.number(),
          name: z.string().nullable(),
          lat: latitude,
          lon: longitude,
          distanceM: z.number().describe("Straight-line distance from the centre in metres"),
          tags: z.record(z.string(), z.string()),
        })
      ),
    },
    annotations,
  },
  async ({ lat, lon, radius_m, tags, name, limit }) =>
    result(await searchNearby({ lat, lon, radiusM: radius_m, tags, name, limit }))
);

server.registerTool(
  "osm_routing",
  {
    title: "Route",
    description:
      "Find a route through two or more locations in order with Valhalla, using OpenStreetMap roads and paths. Returns the distance, the travel time and turn-by-turn directions. Use osm_geocoding first to turn place names into coordinates.",
    inputSchema: {
      locations: z
        .array(z.object({ lat: latitude, lon: longitude }))
        .min(2)
        .max(20)
        .describe("Start, optional stops, and destination, in order"),
      costing: z
        .enum(costings)
        .default("auto")
        .describe("How to travel: auto (car), pedestrian, bicycle, ..."),
      language: z
        .string()
        .optional()
        .describe("Language of the directions, e.g. en-US or ja-JP"),
      include_geometry: z
        .boolean()
        .default(false)
        .describe("Also return the route line as a GeoJSON LineString ([lon, lat] pairs); it can be long"),
    },
    outputSchema: {
      costing: z.enum(costings),
      distanceKm: z.number(),
      durationSeconds: z.number(),
      hasToll: z.boolean(),
      hasHighway: z.boolean(),
      hasFerry: z.boolean(),
      legs: z
        .array(
          z.object({
            distanceKm: z.number(),
            durationSeconds: z.number(),
            maneuvers: z.array(
              z.object({
                instruction: z.string(),
                distanceKm: z.number(),
                durationSeconds: z.number(),
                streetNames: z.array(z.string()).optional(),
              })
            ),
          })
        )
        .describe("One leg between each pair of consecutive locations"),
      geometry: z
        .object({
          type: z.literal("LineString"),
          coordinates: z.array(z.tuple([z.number(), z.number()])),
        })
        .optional(),
    },
    annotations,
  },
  async ({ locations, costing, language, include_geometry }) =>
    result(await route(locations, { costing, language, includeGeometry: include_geometry }))
);

const taginfoNote =
  "Counts come from taginfo and cover the whole planet; dataUntil says when its data was taken.";

const dataUntil = z.string().nullable().describe("When the taginfo data was taken");

server.registerTool(
  "osm_taginfo_keys",
  {
    title: "Find OSM keys",
    description: `Find OpenStreetMap tag keys whose name contains a word, most used first, e.g. 'cuisine' or 'opening_hours'. Use it to discover which keys exist before writing an Overpass query. ${taginfoNote}`,
    inputSchema: {
      query: z.string().min(1).describe("Part of the key name, in English as OSM keys are"),
      limit: z.number().int().min(1).max(50).default(10),
    },
    outputSchema: {
      dataUntil,
      total: z.number().describe("Number of matching keys"),
      keys: z.array(
        z.object({
          key: z.string(),
          count: z.number().describe("Elements with this key"),
          nodes: z.number(),
          ways: z.number(),
          relations: z.number(),
          values: z.number().describe("Number of different values"),
        })
      ),
    },
    annotations,
  },
  async ({ query, limit }) => result(await searchKeys(query, { limit }))
);

server.registerTool(
  "osm_taginfo_values",
  {
    title: "List OSM tag values",
    description: `List the values used with an OpenStreetMap key, most used first, optionally only those containing a word. Use it to find the value mappers actually use, e.g. key 'cuisine' with query 'ramen'. ${taginfoNote}`,
    inputSchema: {
      key: z.string().min(1).describe("The tag key, e.g. amenity or cuisine"),
      query: z.string().optional().describe("Only values containing this text"),
      limit: z.number().int().min(1).max(100).default(20),
    },
    outputSchema: {
      dataUntil,
      key: z.string(),
      total: z.number().describe("Number of matching values"),
      values: z.array(
        z.object({
          value: z.string(),
          count: z.number(),
          fraction: z.number().describe("Share of the elements with this key"),
        })
      ),
    },
    annotations,
  },
  async ({ key, query, limit }) => result(await keyValues(key, { query, limit }))
);

server.registerTool(
  "osm_taginfo_tag",
  {
    title: "Describe an OSM tag",
    description: `Describe an OpenStreetMap tag (key and value) or a key on its own: how many nodes, ways and relations use it, what the OSM wiki says it means and which element types it is meant for, and the tags most often used together with it. Combinations are only computed for frequently used tags, so an empty list does not mean there are none. ${taginfoNote}`,
    inputSchema: {
      key: z.string().min(1).describe("The tag key, e.g. amenity"),
      value: z.string().min(1).optional().describe("The tag value, e.g. cafe; leave out to describe the key"),
      language: z
        .string()
        .optional()
        .describe("Also return the wiki description in this language (e.g. ja); English is always included"),
    },
    outputSchema: {
      dataUntil,
      key: z.string(),
      value: z.string().nullable(),
      count: z.object({
        all: z.number(),
        nodes: z.number(),
        ways: z.number(),
        relations: z.number(),
      }),
      wiki: z.array(
        z.object({
          lang: z.string(),
          title: z.string(),
          description: z.string(),
          status: z.string().optional().describe("e.g. approved, de facto, deprecated"),
          usedOn: z.array(z.enum(["node", "way", "area", "relation"])),
        })
      ),
      combinations: z
        .array(
          z.object({
            key: z.string(),
            value: z.string().nullable().describe("null when only the key is counted"),
            count: z.number(),
            fraction: z.number().describe("Share of the elements with this tag that also have it"),
          })
        )
        .describe("Up to 10 tags most often used together with it"),
    },
    annotations,
  },
  async ({ key, value, language }) => result(await describeTag(key, value, { language }))
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
