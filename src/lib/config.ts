import { readFileSync } from "node:fs";

// package.json sits two levels up from both src/lib and build/lib.
const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { version: string };

export const version: string = pkg.version;

// The public services reject the default User-Agent sent by Node's fetch:
// Nominatim with 403, as its usage policy requires an identifying one, and
// overpass-api.de with 406. Every request carries this one instead.
// https://operations.osmfoundation.org/policies/nominatim/
export const userAgent = `osm-mcp-server/${version} (+https://github.com/yuiseki/osm-mcp-server)`;

export type Endpoints = {
  nominatim: string;
  overpass: string;
  valhalla: string;
  taginfo: string;
};

const defaults: Endpoints = {
  nominatim: "https://nominatim.openstreetmap.org",
  overpass: "https://overpass-api.de/api",
  valhalla: "https://valhalla1.openstreetmap.de",
  taginfo: "https://taginfo.openstreetmap.org",
};

const pick = (value: string | undefined, fallback: string) =>
  (value || fallback).replace(/\/+$/, "");

/**
 * Base URLs of the services, overridable with NOMINATIM_URL, OVERPASS_URL,
 * VALHALLA_URL and TAGINFO_URL so the server can point at a self-hosted OSM
 * stack.
 */
export const endpoints = (
  env: Record<string, string | undefined> = process.env
): Endpoints => ({
  nominatim: pick(env.NOMINATIM_URL, defaults.nominatim),
  overpass: pick(env.OVERPASS_URL, defaults.overpass),
  valhalla: pick(env.VALHALLA_URL, defaults.valhalla),
  taginfo: pick(env.TAGINFO_URL, defaults.taginfo),
});
