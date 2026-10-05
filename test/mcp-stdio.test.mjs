import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test, { after, before } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMockImmich } from "./mock-immich.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = join(root, "dist/index.js");

const mock = createMockImmich();
let baseUrl;
let client;
let downloadDir;

before(async () => {
  baseUrl = await mock.start();
  downloadDir = await mkdtemp(join(tmpdir(), "immich-mcp-test-"));

  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, {
    IMMICH_BASE_URL: baseUrl,
    IMMICH_API_KEY: "test-api-key",
    IMMICH_MCP_LOG_LEVEL: "error",
    IMMICH_MCP_DOWNLOAD_DIR: downloadDir,
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env,
    stderr: "pipe",
  });

  client = new Client({ name: "immich-mcp-test", version: "1.0.0" });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await mock.stop();
  if (downloadDir) await rm(downloadDir, { recursive: true, force: true });
});

test("exposes every operation as a tool", async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 276);
  const names = new Set(tools.map((tool) => tool.name));
  for (const expected of [
    "immich_ping_server",
    "immich_search_assets",
    "immich_create_album",
    "immich_upload_asset",
    "immich_get_all_albums",
    "immich_delete_assets",
  ]) {
    assert.ok(names.has(expected), `missing tool ${expected}`);
  }
});

test("read tool returns the JSON payload", async () => {
  const result = await client.callTool({ name: "immich_ping_server", arguments: {} });
  assert.equal(result.isError, undefined);
  const payload = JSON.parse(result.content[0].text);
  assert.deepEqual(payload, { res: "pong" });
});

test("passes path parameters and returns the JSON payload", async () => {
  mock.requests.length = 0;
  const result = await client.callTool({ name: "immich_get_album_info", arguments: { id: "album-1" } });
  assert.equal(result.isError, undefined);
  const album = JSON.parse(result.content[0].text);
  assert.equal(album.albumName, "Mock Album");
  assert.ok(mock.requests.some((request) => request.url === "/api/albums/album-1"));
});

test("flattened request body is forwarded to the API", async () => {
  mock.requests.length = 0;
  const result = await client.callTool({
    name: "immich_create_album",
    arguments: { albumName: "Holidays", description: "Summer" },
  });
  assert.equal(result.isError, undefined);
  const created = JSON.parse(result.content[0].text);
  assert.equal(created.albumName, "Holidays");

  const post = mock.requests.find((request) => request.method === "POST" && request.url === "/api/albums");
  assert.ok(post, "expected POST /api/albums");
  assert.deepEqual(post.body, { albumName: "Holidays", description: "Summer" });
  assert.equal(post.headers["x-api-key"], "test-api-key");
});

test("rejects a missing required body field", async () => {
  const result = await client.callTool({ name: "immich_create_album", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /albumName/);
});

test("forwards a flattened search body", async () => {
  mock.requests.length = 0;
  const result = await client.callTool({
    name: "immich_search_assets",
    arguments: { size: 1, type: "IMAGE" },
  });
  assert.equal(result.isError, undefined);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.assets.total, 1);

  const post = mock.requests.find((request) => request.method === "POST" && request.url === "/api/search/metadata");
  assert.ok(post, "expected POST /api/search/metadata");
  assert.deepEqual(post.body, { size: 1, type: "IMAGE" });
});

test("surfaces Immich API errors", async () => {
  const result = await client.callTool({ name: "immich_get_album_info", arguments: { id: "missing" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /HTTP 404/);
});

test("exposes resources and reads them", async () => {
  const { resources } = await client.listResources();
  assert.ok(resources.length >= 9);
  const result = await client.readResource({ uri: "immich://server/about" });
  const payload = JSON.parse(result.contents[0].text);
  assert.equal(payload.version, "3.2.4");
});

test("exposes prompts", async () => {
  const { prompts } = await client.listPrompts();
  const names = prompts.map((prompt) => prompt.name);
  assert.ok(names.includes("search_media"));
  assert.ok(names.includes("library_report"));
});

test("downloads binary responses to the download directory", async () => {
  const result = await client.callTool({ name: "immich_download_asset", arguments: { id: "asset-1" } });
  assert.equal(result.isError, undefined);
  const match = /written to (.+?) \(/.exec(result.content[0].text);
  assert.ok(match, `unexpected result: ${result.content[0].text}`);
  const written = await readFile(match[1].trim(), "utf8");
  assert.equal(written, "BINARY-IMAGE-DATA");
});

test("uploads a local file as multipart", async () => {
  mock.requests.length = 0;
  const source = join(downloadDir, "upload-source.jpg");
  await writeFile(source, "hello-upload-bytes");

  const result = await client.callTool({
    name: "immich_upload_asset",
    arguments: {
      assetData: source,
      fileCreatedAt: "2024-01-01T00:00:00.000Z",
      fileModifiedAt: "2024-01-01T00:00:00.000Z",
      filename: "upload-source.jpg",
      isFavorite: true,
    },
  });
  assert.equal(result.isError, undefined);
  const created = JSON.parse(result.content[0].text);
  assert.equal(created.id, "asset-uploaded");

  const post = mock.requests.find((request) => request.method === "POST" && request.url === "/api/assets");
  assert.ok(post, "expected POST /api/assets");
  assert.match(post.headers["content-type"], /multipart\/form-data/);
  assert.match(String(post.body), /hello-upload-bytes/);
  assert.match(String(post.body), /upload-source\.jpg/);
});
