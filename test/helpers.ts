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
