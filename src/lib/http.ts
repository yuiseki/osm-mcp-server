import { userAgent } from "./config.js";

/**
 * fetch with the User-Agent every OSM service asks for. Throws on a non-2xx
 * response, prefixed with label so the model can tell which service failed.
 * The response body is kept in the message because Overpass and Valhalla
 * explain what was wrong with the request there; errorDetail can pull the
 * useful part out of it.
 */
export const request = async (
  label: string,
  url: string,
  init: RequestInit = {},
  errorDetail: (body: string) => string = (body) => body
): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", userAgent);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = errorDetail(body).trim().slice(0, 500);
    throw new Error(
      `${label} failed: ${response.status} ${response.statusText}` +
        (detail ? `\n${detail}` : "")
    );
  }
  return response;
};

/** Valhalla and taginfo explain a failed request as JSON with an error field. */
export const jsonErrorDetail = (body: string): string => {
  try {
    const { error, error_code } = JSON.parse(body);
    if (typeof error === "string") {
      return error_code === undefined ? error : `${error} (error_code ${error_code})`;
    }
  } catch {
    // not JSON
  }
  return body;
};
