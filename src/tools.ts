import { z, type ZodTypeAny } from "zod";
import { createZodContext, jsonSchemaToZod, type ZodFidelityContext } from "./json-schema.js";
import type { JsonSchema, Manifest, OperationManifest } from "./types.js";

export interface ToolDefinition {
  operation: OperationManifest;
  /** Zod raw shape passed to `McpServer.registerTool`. */
  inputSchema: Record<string, ZodTypeAny>;
  /** Input keys that hold a local file path (multipart binary fields). */
  binaryFields: string[];
  /** Input keys that map to real SDK parameters (path/query/header). */
  paramInputKeys: string[];
  /** Input keys that belong to the request body. */
  bodyInputKeys: string[];
}

function refName(schema: JsonSchema): string | undefined {
  if (typeof schema.$ref !== "string") return undefined;
  return schema.$ref.split("/").pop();
}

function isBinarySchema(schema: JsonSchema, schemas: Record<string, JsonSchema>, depth = 0): boolean {
  if (!schema || depth > 8) return false;
  if (schema.format === "binary" || schema.format === "base64") return true;
  const name = refName(schema);
  if (name && schemas[name]) return isBinarySchema(schemas[name]!, schemas, depth + 1);
  return false;
}

export function buildToolDefinitions(manifest: Manifest): ToolDefinition[] {
  const ctx: ZodFidelityContext = createZodContext(manifest.schemas);
  const definitions: ToolDefinition[] = [];

  for (const operation of manifest.operations) {
    const inputSchema: Record<string, ZodTypeAny> = {};
    const paramInputKeys: string[] = [];

    for (const param of operation.params) {
      let type = jsonSchemaToZod(param.schema, ctx);
      if (param.description) type = type.describe(param.description);
      inputSchema[param.name] = param.required ? type : type.optional();
      paramInputKeys.push(param.name);
    }

    const bodyInputKeys: string[] = [];
    const binaryFields: string[] = [];

    if (operation.body?.flattened) {
      const required = new Set(operation.body.requiredProperties ?? []);
      for (const [key, propSchema] of Object.entries(operation.body.properties ?? {})) {
        let type = jsonSchemaToZod(propSchema, ctx);
        type = type.describe(`${key} (request body)`);
        inputSchema[key] = required.has(key) ? type : type.optional();
        bodyInputKeys.push(key);
        if (isBinarySchema(propSchema, manifest.schemas)) binaryFields.push(key);
      }
    } else if (operation.body) {
      const bodySchema = operation.body.schema;
      let type = jsonSchemaToZod(bodySchema, ctx);
      type = type.describe(`${operation.body.sdkName} (request body)`);
      inputSchema.body = operation.body.required ? type : type.optional();
      bodyInputKeys.push("body");
    }

    definitions.push({ operation, inputSchema, binaryFields, paramInputKeys, bodyInputKeys });
  }

  return definitions;
}
