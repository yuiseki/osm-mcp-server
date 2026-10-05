import { endpoints } from "./config.js";
import { request } from "./http.js";

export type OverpassElement = {
  type: string;
  id: number;
  [key: string]: unknown;
};

export type OverpassResult = {
  timestampOsmBase: string | null;
  totalElements: number;
  truncated: boolean;
  elements: OverpassElement[];
};

type OverpassResponse = {
  osm3s?: { timestamp_osm_base?: string };
  elements: OverpassElement[];
  remark?: string;
};

/**
 * Make the query return JSON. Settings such as [timeout:25] have to be the
 * first statement, so [out:json] is stacked onto them when they are there.
 */
export const withJsonOutput = (query: string): string => {
  const trimmed = query.trimStart();
  const out = trimmed.match(/\[out:\s*(\w+)/);
  if (out) {
    if (out[1] !== "json") {
      throw new Error(
        `Only JSON output is supported, but the query asks for [out:${out[1]}]. Use [out:json] or leave [out:...] out.`
      );
    }
    return trimmed;
  }
  return trimmed.startsWith("[") ? `[out:json]${trimmed}` : `[out:json];${trimmed}`;
};

const decodeEntities = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const stripTags = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

/**
 * Overpass reports bad queries as an HTML page; the lines that matter are the
 * ones starting with a bold "Error".
 */
export const overpassErrorDetail = (html: string): string => {
  const errors = [...html.matchAll(/<strong[^>]*>Error<\/strong>:([\s\S]*?)<\/p>/g)].map(
    (m) => stripTags(m[1])
  );
  return errors.length ? errors.join("\n") : stripTags(html);
};

/** Run an Overpass QL query, keeping at most maxElements elements. */
export const runOverpass = async (
  query: string,
  { maxElements = 100 }: { maxElements?: number } = {}
): Promise<OverpassResult> => {
  const response = await request(
    "Overpass",
    `${endpoints().overpass}/interpreter`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: withJsonOutput(query) }).toString(),
    },
    overpassErrorDetail
  );
  const data = (await response.json()) as OverpassResponse;
  // A query that runs out of time or memory still answers 200, with whatever
  // it had so far and the reason in remark. Treat that as the failure it is.
  if (data.remark?.includes("error")) {
    throw new Error(`Overpass ${data.remark}`);
  }
  return {
    timestampOsmBase: data.osm3s?.timestamp_osm_base ?? null,
    totalElements: data.elements.length,
    truncated: data.elements.length > maxElements,
    elements: data.elements.slice(0, maxElements),
  };
};
