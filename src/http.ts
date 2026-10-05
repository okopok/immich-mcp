import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AppConfig } from "./config.js";
import { logger } from "./logger.js";
import { createServer } from "./server.js";

function isAuthorized(req: IncomingMessage, config: AppConfig): boolean {
  if (!config.http.authToken) return true;
  const header = req.headers.authorization;
  if (!header) return false;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token === config.http.authToken;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return undefined;
  return JSON.parse(raw);
}

export interface HttpHandle {
  close(): Promise<void>;
  url: string;
}

export async function startHttpServer(config: AppConfig): Promise<HttpHandle> {
  const { host, port, path } = config.http;

  const httpServer = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (url.pathname === "/health" || url.pathname === "/healthz") {
        send(res, 200, { status: "ok" });
        return;
      }
      if (url.pathname !== path) {
        send(res, 404, { error: "Not found" });
        return;
      }
      if (!isAuthorized(req, config)) {
        res.setHeader("www-authenticate", "Bearer");
        send(res, 401, { error: "Unauthorized" });
        return;
      }
      if (!["POST", "GET", "DELETE"].includes(req.method ?? "")) {
        send(res, 405, { error: "Method not allowed" });
        return;
      }

      let body: unknown;
      if (req.method === "POST") {
        try {
          body = await readJsonBody(req);
        } catch {
          send(res, 400, {
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
          });
          return;
        }
      }

      // Stateless mode: a fresh server + transport handles every request.
      const { server } = createServer(config);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      logger.error("HTTP request failed", error);
      if (!res.headersSent) send(res, 500, { error: "Internal server error" });
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const url = `http://${host}:${port}${path}`;
  logger.info(`Streamable HTTP MCP endpoint listening on ${url}`);

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
