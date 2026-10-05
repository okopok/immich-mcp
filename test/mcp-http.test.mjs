import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMockImmich } from "./mock-immich.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = join(root, "dist/index.js");

const mock = createMockImmich();
let child;
let client;
let port;

function freePort() {
  return new Promise((resolvePort) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const chosen = address.port;
      server.close(() => resolvePort(chosen));
    });
  });
}

async function waitForHealth(url, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not become healthy at ${url}`);
}

before(async () => {
  const baseUrl = await mock.start();
  port = await freePort();

  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, {
    IMMICH_BASE_URL: baseUrl,
    IMMICH_API_KEY: "test-api-key",
    IMMICH_MCP_TRANSPORT: "http",
    IMMICH_MCP_HTTP_HOST: "127.0.0.1",
    IMMICH_MCP_HTTP_PORT: String(port),
    IMMICH_MCP_HTTP_PATH: "/mcp",
    IMMICH_MCP_HTTP_AUTH_TOKEN: "secret-token",
    IMMICH_MCP_LOG_LEVEL: "error",
  });

  child = spawn(process.execPath, [serverEntry], { env, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  await waitForHealth(`http://127.0.0.1:${port}/health`);

  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: "Bearer secret-token" } },
  });
  client = new Client({ name: "immich-mcp-http-test", version: "1.0.0" });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  child?.kill("SIGTERM");
  await mock.stop();
});

test("serves MCP over streamable HTTP", async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 276);
});

test("calls tools over HTTP", async () => {
  const result = await client.callTool({ name: "immich_ping_server", arguments: {} });
  const payload = JSON.parse(result.content[0].text);
  assert.deepEqual(payload, { res: "pong" });
});

test("rejects unauthenticated requests", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(res.status, 401);
});
