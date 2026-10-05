# osm-mcp-server

An [MCP](https://modelcontextprotocol.io/) server that lets AI assistants use OpenStreetMap: find places, look up addresses, query map features with Overpass, search around a point, plan routes, visiting orders, travel time tables and reachable areas with Valhalla, and look up which tags mappers use with taginfo.

## Tools

| Tool | Service | What it does |
|---|---|---|
| `osm_geocoding` | Nominatim | Finds places by name or address. Returns several candidates (default 5, up to 20), because names are often ambiguous. Can be limited to countries and asked for a language. |
| `osm_reverse_geocoding` | Nominatim | Finds the place and the address at a coordinate. |
| `osm_overpass_query` | Overpass API | Runs an Overpass QL query and returns the matching elements (default 100, up to 1000), the total count, and when the data was last updated. |
| `osm_search_nearby` | Overpass API | Finds features with given tags around a point, nearest first, without writing Overpass QL (e.g. `amenity=restaurant` and `cuisine=ramen` within 500 m). Can also filter by name or brand in any language. |
| `osm_routing` | Valhalla | Plans a route through 2 to 20 locations by car, on foot, by bicycle and more. Returns the distance, the travel time, turn-by-turn directions, where each location was placed on the road network, and the route line on request. |
| `osm_optimized_route` | Valhalla | Finds the quickest order to visit 3 to 20 locations, keeping the first and the last, and returns that route with the visiting order and where each location was placed. |
| `osm_route_matrix` | Valhalla | Travel time and distance from every source to every target (up to 25 each), with where each location was placed on the road network and the name of the road it is on. |
| `osm_isochrone` | Valhalla | Returns the area reachable from a point within up to four travel times or distances as GeoJSON polygons, and where the start was placed on the road network. |
| `osm_taginfo_keys` | taginfo | Finds tag keys whose name contains a word, most used first. |
| `osm_taginfo_search` | taginfo | Finds tags of any key whose value contains a word, most used first, for when the key is not known (`convenience` finds `shop=convenience`). |
| `osm_taginfo_values` | taginfo | Lists the values used with a key, most used first, optionally only those containing a word (e.g. `cuisine` values with `ramen`). |
| `osm_taginfo_tag` | taginfo | Describes a tag or a key: how often it is used on nodes, ways and relations, its OSM wiki description in English and one more language, and the tags most often used with it. |

The Valhalla tools move each location onto the nearest road, path or ferry line that the chosen way of travel can use, and say where that is, how far it moved, and the name of what it landed on. Check this when a result looks wrong: a point in Tokyo Bay lands on a ferry line 3.3 km away, and walking there comes out at over 2000 km because it goes by ferry to Kyushu and back.

All tools are read-only. Each returns structured content with an output schema, and the same JSON as text for clients that do not read structured content. Errors from the services, such as an Overpass parse error or a place Valhalla cannot reach, come back as tool errors with the service's own message, so the assistant can correct the request.

## Setup

Requires Node.js 22.12 or later.

```sh
git clone https://github.com/yuiseki/osm-mcp-server.git
cd osm-mcp-server
npm install   # also builds build/index.js
```

Then register `build/index.js` with your MCP client. For Claude Code:

```sh
claude mcp add osm -- node /path/to/osm-mcp-server/build/index.js
```

For Claude Desktop and other clients that use a JSON config:

```json
{
  "mcpServers": {
    "osm": {
      "command": "node",
      "args": ["/path/to/osm-mcp-server/build/index.js"]
    }
  }
}
```

Or run it with Docker:

```sh
docker build -t osm-mcp-server .
docker run -i --rm osm-mcp-server
```

## Choosing the servers

By default the tools use the public OpenStreetMap services. To use your own, set these environment variables:

| Variable | Default |
|---|---|
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` |
| `OVERPASS_URL` | `https://overpass-api.de/api` |
| `VALHALLA_URL` | `https://valhalla1.openstreetmap.de` |
| `TAGINFO_URL` | `https://taginfo.openstreetmap.org` |

For example:

```json
{
  "mcpServers": {
    "osm": {
      "command": "node",
      "args": ["/path/to/osm-mcp-server/build/index.js"],
      "env": {
        "NOMINATIM_URL": "https://nominatim.example.org",
        "OVERPASS_URL": "https://overpass.example.org/api",
        "VALHALLA_URL": "https://valhalla.example.org",
        "TAGINFO_URL": "https://taginfo.example.org"
      }
    }
  }
}
```

The public services are shared, run by volunteers, and each has a usage policy that limits how often you may call it (for example [Nominatim's](https://operations.osmfoundation.org/policies/nominatim/)). For heavy use, run your own. Every request carries a `User-Agent` that names this project.

## Development

```sh
npm run lint        # type-check the source and the tests
npm test            # unit tests, and the built server over stdio against a local stub of the services
npm run test:live   # the built server against real services
```

`npm test` needs no network and runs in CI on Node 22 and 24. `npm run test:live` is not part of CI. By default it uses the maintainer's self-hosted services; set the variables above to test against your own.

## License

MIT. Map data © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright).
