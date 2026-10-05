import { isAbsolute, resolve } from "node:path";
import { logger } from "./logger.js";

export type TransportMode = "stdio" | "http" | "both";

export interface ToolFilter {
  /** Only expose operations whose tag is in this list (case-insensitive). */
  includeTags?: string[];
  excludeTags?: string[];
  /** Only expose these tool names. */
  includeTools?: string[];
  excludeTools?: string[];
  /** Only expose read-only (GET/HEAD) operations. */
  readOnly: boolean;
}

export interface AppConfig {
  baseUrl: string;
  apiKey?: string;
  accessToken?: string;
  headers: Record<string, string>;
  transport: TransportMode;
  http: {
    host: string;
    port: number;
    path: string;
    /** Optional bearer token required to call the HTTP endpoint. */
    authToken?: string;
  };
  downloadDir: string;
  maxResultChars: number;
  filter: ToolFilter;
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "") pathname = "/api";
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined && value !== null) result[key] = String(value);
    }
    return result;
  } catch (error) {
    throw new Error(`IMMICH_HEADERS must be a JSON object: ${(error as Error).message}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const baseUrlRaw = env.IMMICH_BASE_URL?.trim();
  if (!baseUrlRaw) {
    throw new Error("IMMICH_BASE_URL is required (e.g. http://localhost:2283/api)");
  }

  const apiKey = env.IMMICH_API_KEY?.trim() || undefined;
  const accessToken = env.IMMICH_ACCESS_TOKEN?.trim() || undefined;
  if (!apiKey && !accessToken) {
    throw new Error("Either IMMICH_API_KEY or IMMICH_ACCESS_TOKEN is required");
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(baseUrlRaw);
  } catch {
    throw new Error(`IMMICH_BASE_URL is not a valid URL: ${baseUrlRaw}`);
  }

  const transportRaw = (env.IMMICH_MCP_TRANSPORT ?? "stdio").toLowerCase();
  if (!["stdio", "http", "both"].includes(transportRaw)) {
    throw new Error(`IMMICH_MCP_TRANSPORT must be one of stdio|http|both (got "${transportRaw}")`);
  }

  const downloadDirRaw = env.IMMICH_MCP_DOWNLOAD_DIR?.trim() || "./downloads";
  const downloadDir = isAbsolute(downloadDirRaw) ? downloadDirRaw : resolve(process.cwd(), downloadDirRaw);

  const maxResultCharsRaw = Number.parseInt(env.IMMICH_MCP_MAX_RESULT_CHARS ?? "", 10);
  const maxResultChars = Number.isFinite(maxResultCharsRaw) && maxResultCharsRaw > 0 ? maxResultCharsRaw : 200_000;

  const portRaw = Number.parseInt(env.IMMICH_MCP_HTTP_PORT ?? "", 10);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 3000;

  const config: AppConfig = {
    baseUrl,
    apiKey,
    accessToken,
    headers: parseHeaders(env.IMMICH_HEADERS),
    transport: transportRaw as TransportMode,
    http: {
      host: env.IMMICH_MCP_HTTP_HOST?.trim() || "127.0.0.1",
      port,
      path: env.IMMICH_MCP_HTTP_PATH?.trim() || "/mcp",
      authToken: env.IMMICH_MCP_HTTP_AUTH_TOKEN?.trim() || undefined,
    },
    downloadDir,
    maxResultChars,
    filter: {
      includeTags: splitList(env.IMMICH_MCP_TAGS),
      excludeTags: splitList(env.IMMICH_MCP_EXCLUDE_TAGS),
      includeTools: splitList(env.IMMICH_MCP_TOOLS),
      excludeTools: splitList(env.IMMICH_MCP_EXCLUDE_TOOLS),
      readOnly: bool(env.IMMICH_MCP_READONLY),
    },
  };

  logger.debug("Loaded configuration", {
    baseUrl: config.baseUrl,
    transport: config.transport,
    downloadDir: config.downloadDir,
  });
  return config;
}

/** Returns true when the given operation should be exposed as a tool. */
export function isOperationEnabled(
  filter: ToolFilter,
  operation: { toolName: string; tag: string; readOnly: boolean },
): boolean {
  if (filter.readOnly && !operation.readOnly) return false;

  const tag = operation.tag.toLowerCase();
  if (filter.includeTags && !filter.includeTags.some((t) => t.toLowerCase() === tag)) return false;
  if (filter.excludeTags?.some((t) => t.toLowerCase() === tag)) return false;

  const tool = operation.toolName.toLowerCase();
  if (filter.includeTools && !filter.includeTools.some((t) => t.toLowerCase() === tool)) return false;
  if (filter.excludeTools?.some((t) => t.toLowerCase() === tool)) return false;

  return true;
}
