import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export type StubRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: string;
};

export type StubResponse = { status?: number; body: unknown };

/**
 * A local HTTP server standing in for Nominatim, Overpass and Valhalla, so the
 * built bin can be tested end to end without the network. Each path answers
 * with whatever the test put in routes; every request is recorded.
 */
export const startStubOsm = async () => {
  const routes = new Map<string, (req: StubRequest) => StubResponse>();
  const requests: StubRequest[] = [];

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const url = new URL(req.url ?? "/", "http://localhost");
    const stubRequest: StubRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
    requests.push(stubRequest);
    const route = routes.get(url.pathname);
    const { status = 200, body } = route
      ? route(stubRequest)
      : { status: 404, body: `no stub for ${url.pathname}` };
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  return {
    routes,
    requests,
    env: {
      NOMINATIM_URL: `${base}/nominatim`,
      OVERPASS_URL: `${base}/overpass/api`,
      VALHALLA_URL: `${base}/valhalla`,
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};
