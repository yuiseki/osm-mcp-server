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

/**
 * Replaces the global fetch with one that answers by URL path. Paths without
 * a body get a 404.
 */
export const mockFetchByPath = (bodies: Record<string, unknown>) => {
  const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
    const { pathname } = new URL(url);
    return pathname in bodies
      ? new Response(JSON.stringify(bodies[pathname]), { status: 200 })
      : new Response("not found", { status: 404, statusText: "Not Found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
