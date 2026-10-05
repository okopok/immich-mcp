import { createServer as createHttpServer } from "node:http";

/**
 * A tiny stand-in for the Immich API used by the integration tests.
 * It records every request so tests can assert what the MCP server sent.
 */
export function createMockImmich() {
  const requests = [];

  const server = createHttpServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });

      const json = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      const route = `${req.method} ${req.url?.split("?")[0]}`;

      if (req.method === "GET" && req.url?.split("?")[0] === "/api/assets/asset-1/original") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.from("BINARY-IMAGE-DATA"));
        return;
      }

      switch (route) {
        case "GET /api/server/ping":
          return json(200, { res: "pong" });
        case "GET /api/server/about":
          return json(200, { version: "3.2.4", versionUrl: "https://immich.app" });
        case "GET /api/server/version":
          return json(200, { major: 3, minor: 2, patch: 4 });
        case "GET /api/server/statistics":
          return json(200, { photos: 42, videos: 1, albums: 2 });
        case "GET /api/server/storage":
          return json(200, [{ diskSize: "1 GiB", diskUse: "1 MiB", diskAvailable: "1 GiB" }]);
        case "GET /api/users/me":
          return json(200, { id: "user-1", email: "me@example.com", name: "Me" });
        case "GET /api/albums":
          return json(200, [{ id: "album-1", albumName: "Mock Album", assetCount: 3 }]);
        case "GET /api/albums/album-1":
          return json(200, { id: "album-1", albumName: "Mock Album", assets: [], albumUsers: [] });
        case "POST /api/albums":
          return json(201, { id: "album-new", albumName: body?.albumName, assetCount: 0 });
        case "POST /api/assets":
          return json(201, { id: "asset-uploaded", status: "created" });
        case "GET /api/people":
          return json(200, { people: [], total: 0, hasNextPage: false });
        case "GET /api/tags":
          return json(200, []);
        case "GET /api/memories":
          return json(200, []);
        case "POST /api/search/metadata":
          return json(200, {
            albums: { total: 0, count: 0, items: [], facets: [] },
            assets: { total: 1, count: 1, items: [{ id: "asset-1", type: "IMAGE" }], facets: [] },
          });
        case "GET /api/assets/statistics":
          return json(200, { total: 1, images: 1, videos: 0 });
        default:
          return json(404, { message: "not found", error: "Not Found", statusCode: 404 });
      }
    });
  });

  return {
    requests,
    start: () =>
      new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resolve(`http://127.0.0.1:${address.port}/api`);
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
