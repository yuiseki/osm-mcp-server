import { vi } from "vitest";

/** Replaces the global fetch with one that answers every request with body. */
export const mockFetch = (
  body: unknown,
  init: { status?: number; statusText?: string } = {}
) => {
  const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: init.status ?? 200,
      statusText: init.statusText ?? "OK",
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

/** The first request made through a mockFetch. */
export const requestOf = (fetchMock: ReturnType<typeof mockFetch>) => {
  const [url, options] = fetchMock.mock.calls[0];
  return {
    url: new URL(url),
    method: options?.method ?? "GET",
    headers: new Headers(options?.headers),
    body: options?.body,
  };
};

export type Reply = { status?: number; statusText?: string; body: unknown };

/**
 * Replaces the global fetch with one that answers by URL path, either with a
 * fixed body or with a function of the request body. Paths without an answer
 * get a 404.
 */
export const mockFetchByPath = (
  answers: Record<string, unknown | ((body: any) => Reply)>
) => {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const { pathname } = new URL(url);
    if (!(pathname in answers)) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    const answer = answers[pathname];
    const { status = 200, statusText = "OK", body } =
      typeof answer === "function"
        ? (answer as (body: any) => Reply)(options?.body ? JSON.parse(String(options.body)) : undefined)
        : { body: answer };
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, statusText });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

/** The request a mockFetchByPath received for path. */
export const requestTo = (fetchMock: ReturnType<typeof mockFetchByPath>, path: string) => {
  const call = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === path);
  if (!call) throw new Error(`no request to ${path}`);
  const [url, options] = call;
  return {
    url: new URL(url),
    method: options?.method ?? "GET",
    headers: new Headers(options?.headers),
    body: options?.body,
  };
};

/**
 * A /locate answer that puts every location 0 m away on a road named after
 * its index, so tests can see which snap belongs to which location.
 */
export const locateOnTheSpot = (body: { locations: { lat: number; lon: number }[] }): Reply => ({
  body: body.locations.map(({ lat, lon }, i) => ({
    input_lat: lat,
    input_lon: lon,
    edges: [{ correlated_lat: lat, correlated_lon: lon, distance: 0, edge_info: { names: [`road ${i}`] } }],
  })),
});
