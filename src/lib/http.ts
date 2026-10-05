import { userAgent } from "./config.js";

/**
 * fetch with the User-Agent every OSM service asks for. Throws on a non-2xx
 * response, prefixed with label so the model can tell which service failed.
 * The response body is kept in the message because Overpass and Valhalla
 * explain what was wrong with the request there.
 */
export const request = async (
  label: string,
  url: string,
  init: RequestInit = {}
): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", userAgent);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim().slice(0, 500);
    throw new Error(
      `${label} failed: ${response.status} ${response.statusText}` +
        (detail ? `\n${detail}` : "")
    );
  }
  return response;
};
