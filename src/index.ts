#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type ToolFilter } from "./config.js";
import { startHttpServer } from "./http.js";
import { initImmich } from "./immich.js";
import { logger } from "./logger.js";
import { createServer, getToolDefinitions } from "./server.js";
import { VERSION } from "./version.js";

const USAGE = `immich-mcp ${VERSION} — Model Context Protocol server for Immich

Usage:
  immich-mcp                 Start the MCP server (transport from IMMICH_MCP_TRANSPORT, default stdio)
  immich-mcp --list-tools    Print all available tools and exit
  immich-mcp --list-groups   Print tool counts per API group and exit
  immich-mcp --version       Print the version and exit
  immich-mcp --help          Show this help

Required environment:
  IMMICH_BASE_URL   Immich API base URL, e.g. http://localhost:2283/api
  IMMICH_API_KEY    Immich API key (or IMMICH_ACCESS_TOKEN)

See .env.example and README.md for the full list of options.`;

const DEFAULT_FILTER: ToolFilter = { readOnly: false };

function listTools(filter: ToolFilter, group: boolean): void {
  const definitions = getToolDefinitions();
  const enabled = definitions.filter((definition) => {
    const operation = definition.operation;
    if (filter.readOnly && !operation.readOnly) return false;
    if (filter.includeTags && !filter.includeTags.some((tag) => tag.toLowerCase() === operation.tag.toLowerCase())) {
      return false;
    }
    if (filter.excludeTags?.some((tag) => tag.toLowerCase() === operation.tag.toLowerCase())) return false;
    if (filter.includeTools && !filter.includeTools.some((tool) => tool.toLowerCase() === operation.toolName.toLowerCase())) {
      return false;
    }
    if (filter.excludeTools?.some((tool) => tool.toLowerCase() === operation.toolName.toLowerCase())) return false;
    return true;
  });

  if (group) {
    const counts = new Map<string, number>();
    for (const definition of enabled) {
      const tag = definition.operation.tag;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    for (const [tag, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      process.stdout.write(`${String(count).padStart(3)}  ${tag}\n`);
    }
    process.stdout.write(`\n${enabled.length} tools in ${counts.size} groups\n`);
    return;
  }

  for (const definition of enabled) {
    const operation = definition.operation;
    process.stdout.write(`${operation.toolName}\t${operation.method} ${operation.path}\t${operation.summary}\n`);
  }
  process.stdout.write(`\n${enabled.length} tools\n`);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));

  if (args.has("--help") || args.has("-h")) {
    process.stdout.write(USAGE + "\n");
    return;
  }
  if (args.has("--version") || args.has("-v")) {
    process.stdout.write(VERSION + "\n");
    return;
  }
  if (args.has("--list-tools") || args.has("--list-groups")) {
    let filter: ToolFilter = DEFAULT_FILTER;
    try {
      filter = loadConfig().filter;
    } catch {
      // Listing tools does not require credentials.
    }
    listTools(filter, args.has("--list-groups"));
    return;
  }

  const config = loadConfig();
  initImmich(config);

  const handles: Array<{ close(): Promise<void> }> = [];

  if (config.transport === "stdio" || config.transport === "both") {
    const { server } = createServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    handles.push({ close: () => server.close() });
    logger.info("Immich MCP server running on stdio");
  }

  if (config.transport === "http" || config.transport === "both") {
    const handle = await startHttpServer(config);
    handles.push(handle);
  }

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down`);
    await Promise.allSettled(handles.map((handle) => handle.close()));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error((error as Error).message);
  process.exit(1);
});
