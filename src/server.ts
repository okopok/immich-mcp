import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { isOperationEnabled } from "./config.js";
import { manifest } from "./generated/manifest.js";
import { sdk } from "./immich.js";
import { logger } from "./logger.js";
import type { OperationManifest } from "./types.js";
import { buildToolDefinitions, type ToolDefinition } from "./tools.js";
import { invokeOperation } from "./invoke.js";
import { SERVER_INFO } from "./version.js";

const IDEMPOTENT_METHODS = new Set(["GET", "PUT", "DELETE", "HEAD"]);
const DESTRUCTIVE_METHODS = new Set(["DELETE"]);

function buildDescription(operation: OperationManifest): string {
  const parts: string[] = [operation.summary];
  if (operation.description && operation.description.trim() !== operation.summary.trim()) {
    parts.push(operation.description.trim());
  }
  parts.push(`Immich operation: ${operation.method} ${operation.path} · tag: ${operation.tag}`);
  if (operation.deprecated) parts.push("DEPRECATED — prefer the replacement operation if one exists.");
  return parts.join("\n\n");
}

function toolAnnotations(operation: OperationManifest) {
  return {
    title: operation.summary,
    readOnlyHint: operation.readOnly,
    destructiveHint: DESTRUCTIVE_METHODS.has(operation.method),
    idempotentHint: IDEMPOTENT_METHODS.has(operation.method),
    openWorldHint: true,
  };
}

function registerTools(server: McpServer, config: AppConfig, definitions: ToolDefinition[]): number {
  let registered = 0;
  for (const definition of definitions) {
    const operation = definition.operation;
    if (!isOperationEnabled(config.filter, operation)) continue;
    server.registerTool(
      operation.toolName,
      {
        title: operation.summary,
        description: buildDescription(operation),
        inputSchema: definition.inputSchema,
        annotations: toolAnnotations(operation),
      },
      // The callback receives validated arguments matching `inputSchema`.
      async (args: Record<string, unknown>) => invokeOperation(definition, args, config),
    );
    registered++;
  }
  return registered;
}

async function callOperation(operationId: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const fn = (sdk as unknown as Record<string, (input: Record<string, unknown>) => Promise<unknown>>)[operationId];
  if (typeof fn !== "function") throw new Error(`Unknown SDK operation ${operationId}`);
  return fn(args);
}

interface ResourceDefinition {
  name: string;
  uri: string;
  title: string;
  description: string;
  call: () => Promise<unknown>;
}

function resourceDefinitions(): ResourceDefinition[] {
  return [
    {
      name: "immich-server-about",
      uri: "immich://server/about",
      title: "Immich server about",
      description: "Server version and build information.",
      call: () => callOperation("getAboutInfo"),
    },
    {
      name: "immich-server-version",
      uri: "immich://server/version",
      title: "Immich server version",
      description: "Current server version and release channel.",
      call: () => callOperation("getServerVersion"),
    },
    {
      name: "immich-server-storage",
      uri: "immich://server/storage",
      title: "Immich storage usage",
      description: "Disk usage per storage location.",
      call: () => callOperation("getStorage"),
    },
    {
      name: "immich-server-statistics",
      uri: "immich://server/statistics",
      title: "Immich server statistics",
      description: "Aggregate asset, user and album statistics.",
      call: () => callOperation("getServerStatistics"),
    },
    {
      name: "immich-user-me",
      uri: "immich://user/me",
      title: "Current Immich user",
      description: "Profile of the authenticated user.",
      call: () => callOperation("getMyUser"),
    },
    {
      name: "immich-albums",
      uri: "immich://albums",
      title: "Albums",
      description: "All albums with asset counts and cover images.",
      call: () => callOperation("getAllAlbums"),
    },
    {
      name: "immich-people",
      uri: "immich://people",
      title: "People",
      description: "All recognized people.",
      call: () => callOperation("getAllPeople"),
    },
    {
      name: "immich-tags",
      uri: "immich://tags",
      title: "Tags",
      description: "All tags in the library.",
      call: () => callOperation("getAllTags"),
    },
    {
      name: "immich-memories",
      uri: "immich://memories",
      title: "Memories",
      description: "Available memories for the current user.",
      call: () => callOperation("searchMemories", {}),
    },
  ];
}

function registerResources(server: McpServer, config: AppConfig): void {
  for (const resource of resourceDefinitions()) {
    server.registerResource(
      resource.name,
      resource.uri,
      { title: resource.title, description: resource.description, mimeType: "application/json" },
      async (): Promise<ReadResourceResult> => {
        const text = await readResourceText(resource, config);
        return { contents: [{ uri: resource.uri, mimeType: "application/json", text }] };
      },
    );
  }
}

async function readResourceText(resource: ResourceDefinition, config: AppConfig): Promise<string> {
  try {
    const result = await resource.call();
    const json = JSON.stringify(result ?? null, null, 2);
    return json.length > config.maxResultChars ? json.slice(0, config.maxResultChars) : json;
  } catch (error) {
    return JSON.stringify({ error: (error as Error).message }, null, 2);
  }
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "search_media",
    {
      title: "Find media in Immich",
      description: "Guide the assistant to search for assets using the Immich search tools.",
      argsSchema: {
        description: z.string().describe("What to search for, e.g. 'beach photos from 2023'"),
      },
    },
    ({ description }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Find media matching: ${description}`,
              "",
              "Use the Immich MCP tools. Prefer immich_search_assets (smart/metadata search) and",
              "immich_search_smart or immich_search_metadata. Summarise the matches with ids,",
              "types, dates and, when relevant, the album or person they belong to.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "organize_album",
    {
      title: "Organise an album",
      description: "Create or update an album based on search criteria.",
      argsSchema: {
        album: z.string().describe("Album name to create or update"),
        criteria: z.string().describe("Which assets should be added"),
      },
    },
    ({ album, criteria }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Organise the Immich album "${album}" using assets matching: ${criteria}`,
              "",
              "1. Search for candidate assets with immich_search_assets.",
              "2. Find or create the album (immich_get_all_albums / immich_create_album).",
              "3. Add the assets with immich_add_assets_to_album.",
              "Report exactly what you changed.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "library_report",
    {
      title: "Immich library report",
      description: "Summarise the state of the Immich library.",
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Produce a short report about this Immich instance.",
              "Use immich_get_server_statistics, immich_get_storage, immich_get_all_albums and",
              "immich_get_all_people. Include total assets, storage usage, number of albums and people,",
              "and call out anything that looks unhealthy (e.g. failed jobs via immich_get_jobs).",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

export interface CreatedServer {
  server: McpServer;
  toolCount: number;
  totalOperations: number;
}

let cachedDefinitions: ToolDefinition[] | undefined;

/** Tool definitions are expensive to build, so they are computed once per process. */
export function getToolDefinitions(): ToolDefinition[] {
  cachedDefinitions ??= buildToolDefinitions(manifest);
  return cachedDefinitions;
}

export function createServer(config: AppConfig): CreatedServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
  });

  const definitions = getToolDefinitions();
  const toolCount = registerTools(server, config, definitions);
  registerResources(server, config);
  registerPrompts(server);

  logger.info(`Registered ${toolCount}/${definitions.length} tools, resources and prompts`);

  return { server, toolCount, totalOperations: definitions.length };
}
