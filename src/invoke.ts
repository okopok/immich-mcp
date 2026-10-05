import { File as BufferFile } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { isHttpError } from "@immich/sdk";
import type { AppConfig } from "./config.js";
import { sdk } from "./immich.js";
import { logger } from "./logger.js";
import type { ToolDefinition } from "./tools.js";

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const FileCtor: typeof File =
  (globalThis as { File?: typeof File }).File ?? (BufferFile as unknown as typeof File);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".dng": "image/x-adobe-dng",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".json": "application/json",
  ".zip": "application/zip",
  ".sql": "application/sql",
};

function mimeTypeForFile(name: string): string {
  return MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? "application/octet-stream";
}

function extensionForMime(mime: string): string {
  const found = Object.entries(MIME_BY_EXTENSION).find(([, value]) => value === mime);
  return found ? found[0] : "";
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const remaining = text.length - max;
  return `${text.slice(0, max)}\n\n... [truncated: ${remaining} more characters of ${text.length} total]`;
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Reads a local path or data URL into a `File` suitable for multipart uploads. */
async function toUploadFile(value: string): Promise<File> {
  if (value.startsWith("data:")) {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value);
    if (!match) throw new Error("Invalid data URL for upload");
    const [, mime = "application/octet-stream", base64, payload = ""] = match;
    const buffer = Buffer.from(payload, base64 ? "base64" : "utf8");
    return new FileCtor([buffer], "upload", { type: mime || "application/octet-stream" });
  }

  const path = isAbsolute(value) ? value : resolve(process.cwd(), value);
  const buffer = await readFile(path);
  const name = basename(path);
  return new FileCtor([buffer], name, { type: mimeTypeForFile(name) });
}

async function buildSdkArgs(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { operation } = tool;
  const sdkArgs: Record<string, unknown> = {};

  for (const param of operation.params) {
    const value = args[param.name];
    if (value !== undefined) sdkArgs[param.sdkName] = value;
  }

  if (operation.body) {
    const body = operation.body;
    let bodyValue: unknown;

    if (body.flattened) {
      const object: Record<string, unknown> = {};
      for (const key of tool.bodyInputKeys) {
        const value = args[key];
        if (value === undefined) continue;
        object[key] = tool.binaryFields.includes(key) ? await toUploadFile(String(value)) : value;
      }
      bodyValue = object;
    } else {
      bodyValue = args.body;
      if (bodyValue !== undefined && body.hasBinary && bodyValue && typeof bodyValue === "object") {
        const object = { ...(bodyValue as Record<string, unknown>) };
        for (const [key, value] of Object.entries(object)) {
          if (typeof value === "string") {
            const prop = (body.properties ?? {})[key];
            if (prop && (prop.format === "binary" || prop.format === "base64")) {
              object[key] = await toUploadFile(value);
            }
          }
        }
        bodyValue = object;
      }
    }

    const isEmpty =
      bodyValue === undefined ||
      (typeof bodyValue === "object" && bodyValue !== null && Object.keys(bodyValue).length === 0);
    if (isEmpty && body.required) {
      throw new Error(`Missing required request body for ${operation.operationId}`);
    }
    if (!isEmpty) sdkArgs[body.sdkName] = bodyValue;
  }

  return sdkArgs;
}

async function saveBlob(
  blob: Blob,
  tool: ToolDefinition,
  args: Record<string, unknown>,
  config: AppConfig,
): Promise<string> {
  const { operation } = tool;
  const directory = join(config.downloadDir, operation.operationId);
  await mkdir(directory, { recursive: true });

  const declaredName = typeof args.filename === "string" ? args.filename : undefined;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = declaredName ?? `${operation.operationId}-${timestamp}${extensionForMime(blob.type)}`;
  const path = join(directory, basename(name));

  const buffer = Buffer.from(await blob.arrayBuffer());
  await writeFile(path, buffer);
  return `${buffer.length} bytes written to ${path}${blob.type ? ` (${blob.type})` : ""}`;
}

export async function invokeOperation(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  config: AppConfig,
): Promise<ToolResult> {
  const { operation } = tool;
  const fn = (sdk as unknown as Record<string, (...input: unknown[]) => Promise<unknown>>)[
    operation.operationId
  ];
  if (typeof fn !== "function") {
    return errorResult(`SDK function "${operation.operationId}" is not available`);
  }

  let sdkArgs: Record<string, unknown>;
  try {
    sdkArgs = await buildSdkArgs(tool, args);
  } catch (error) {
    return errorResult((error as Error).message);
  }

  logger.debug(`Calling ${operation.operationId}`, { args: sdkArgs });

  try {
    const result = await fn(sdkArgs);

    if (result === undefined || result === null) {
      return textResult(`OK — ${operation.operationId} completed with no response body.`);
    }
    if (typeof Blob !== "undefined" && result instanceof Blob) {
      return textResult(await saveBlob(result, tool, args, config));
    }
    if (result instanceof Uint8Array || result instanceof ArrayBuffer) {
      const buffer = result instanceof Uint8Array ? result : new Uint8Array(result);
      return textResult(await saveBlob(new Blob([buffer as unknown as BlobPart]), tool, args, config));
    }
    if (typeof result === "string") {
      return textResult(truncate(result, config.maxResultChars));
    }
    return textResult(truncate(JSON.stringify(result, null, 2), config.maxResultChars));
  } catch (error) {
    return errorResult(formatError(error, operation.operationId));
  }
}

function formatError(error: unknown, operationId: string): string {
  if (isHttpError(error)) {
    const data = error.data as { message?: string; error?: string; statusCode?: number; errors?: unknown } | undefined;
    const parts = [`Immich API error while calling ${operationId}: HTTP ${error.status}`];
    if (data?.message) parts.push(data.message);
    if (data?.error) parts.push(`(${data.error})`);
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      parts.push(`Validation errors: ${JSON.stringify(data.errors)}`);
    }
    return parts.join(" ");
  }
  if (error instanceof Error) {
    return `Error while calling ${operationId}: ${error.message}`;
  }
  return `Error while calling ${operationId}: ${String(error)}`;
}
