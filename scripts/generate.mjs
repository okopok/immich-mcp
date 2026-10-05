#!/usr/bin/env node
/**
 * Generates `src/generated/manifest.ts` from the Immich OpenAPI specification.
 *
 * The manifest is a self-contained data structure describing every API
 * operation: its parameters, request body, and the exact parameter names that
 * the generated `@immich/sdk` functions expect. The runtime turns each entry
 * into an MCP tool.
 *
 * It also cross-checks the derived SDK parameter names against the actual
 * `@immich/sdk` type declarations (spec/sdk-client.d.ts) so that drift between
 * the specification and the SDK is caught at build time.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const specFile = resolve(root, "spec/immich-openapi-specs.json");
const dtsFile = resolve(root, "spec/sdk-client.d.ts");
const outFile = resolve(root, "src/generated/manifest.ts");

/** Words which are not valid JS identifiers as object keys (the SDK prefixes them with `$`). */
const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
  "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw",
  "true", "try", "typeof", "var", "void", "while", "with", "yield", "let", "static", "await",
  "implements", "package", "protected", "interface", "private", "public", "type", "from",
  "as", "of", "get", "set",
]);

function sdkParamName(name, location) {
  if (location === "header") {
    return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }
  return RESERVED.has(name) ? `$${name}` : name;
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function snakeCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function refName(schema) {
  if (!schema || typeof schema.$ref !== "string") return undefined;
  return schema.$ref.split("/").pop();
}

/** Returns true when the schema subtree contains a binary field. */
function containsBinary(schema, schemas, seen = new Set()) {
  if (!schema || typeof schema !== "object") return false;
  if (schema.format === "binary" || schema.format === "base64") return true;
  const ref = refName(schema);
  if (ref) {
    if (seen.has(ref)) return false;
    seen.add(ref);
    return containsBinary(schemas[ref], schemas, seen);
  }
  for (const child of Object.values(schema.properties ?? {})) {
    if (containsBinary(child, schemas, seen)) return true;
  }
  if (schema.items && typeof schema.items === "object" && containsBinary(schema.items, schemas, seen)) {
    return true;
  }
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    for (const child of schema[key] ?? []) {
      if (containsBinary(child, schemas, seen)) return true;
    }
  }
  return false;
}

function resolveRef(schema, schemas, depth = 0) {
  if (!schema || depth > 20) return schema;
  const ref = refName(schema);
  if (ref && schemas[ref]) return schemas[ref];
  return schema;
}

function parseSdkParams(dts) {
  const map = new Map();
  const re = /export declare function (\w+)\(\{\s*([^}]*)\}/g;
  let match;
  while ((match = re.exec(dts))) {
    map.set(
      match[1],
      match[2]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    );
  }
  return map;
}

function mergeParameters(pathItem, operation) {
  const byKey = new Map();
  for (const param of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    byKey.set(`${param.in}:${param.name}`, param);
  }
  return [...byKey.values()];
}

function paramSchema(param) {
  if (param.schema) return param.schema;
  const content = param.content && Object.values(param.content)[0];
  return (content && content.schema) || { type: "string" };
}

function responseContentTypes(operation) {
  const types = new Set();
  for (const response of Object.values(operation.responses ?? {})) {
    for (const contentType of Object.keys(response.content ?? {})) {
      types.add(contentType);
    }
  }
  return [...types];
}

async function main() {
  const specText = await readFile(specFile, "utf8");
  const spec = JSON.parse(specText);
  const specHash = createHash("sha256").update(specText).digest("hex").slice(0, 16);
  const schemas = spec.components?.schemas ?? {};

  let dts = "";
  try {
    dts = await readFile(dtsFile, "utf8");
  } catch {
    console.warn("! spec/sdk-client.d.ts not found, skipping SDK cross-check");
  }
  const sdkParams = parseSdkParams(dts);

  const operations = [];
  const warnings = [];
  const toolNames = new Set();

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operation.operationId) continue;
      const operationId = operation.operationId;
      const params = mergeParameters(pathItem, operation).map((param) => ({
        name: param.name,
        sdkName: sdkParamName(param.name, param.in),
        in: param.in,
        required: param.required === true || param.in === "path",
        schema: paramSchema(param),
        description: param.description,
      }));

      let body;
      if (operation.requestBody) {
        const contentTypes = Object.keys(operation.requestBody.content ?? {});
        const contentType = contentTypes[0] ?? "application/json";
        const schema = operation.requestBody.content?.[contentType]?.schema ?? {};
        const ref = refName(schema);
        const sdkName = ref ? lowerFirst(ref) : "body";
        const resolved = resolveRef(schema, schemas);
        const properties = resolved?.properties ?? {};
        const propertyNames = Object.keys(properties);
        const paramNames = new Set(params.map((p) => p.name));
        const hasCollision = propertyNames.some((name) => paramNames.has(name));
        const isObject = (resolved?.type === "object" || propertyNames.length > 0) && propertyNames.length > 0;
        const flattened = isObject && !hasCollision;

        body = {
          sdkName,
          schema,
          required: operation.requestBody.required === true,
          contentType,
          multipart: contentType.includes("multipart"),
          flattened,
          ...(flattened
            ? {
                properties,
                requiredProperties: resolved.required ?? [],
              }
            : {}),
          hasBinary: containsBinary(schema, schemas),
        };
      }

      // Cross-check derived SDK parameter names against the real SDK declarations.
      const declared = sdkParams.get(operationId);
      if (dts && declared && (params.length > 0 || body)) {
        const expected = params.map((p) => p.sdkName);
        for (const name of expected) {
          if (!declared.includes(name)) {
            warnings.push(`${operationId}: expected SDK parameter "${name}" not found in ${operationId}()`);
          }
        }
        const extras = declared.filter((name) => !expected.includes(name));
        if (body && extras.length !== 1) {
          warnings.push(`${operationId}: expected exactly one body parameter, got [${extras.join(", ")}]`);
        } else if (body && extras[0] !== body.sdkName) {
          warnings.push(`${operationId}: body parameter derived as "${body.sdkName}" but SDK declares "${extras[0]}"`);
          body.sdkName = extras[0];
        }
      }

      let toolName = `immich_${snakeCase(operationId)}`;
      if (toolNames.has(toolName)) {
        let i = 2;
        while (toolNames.has(`${toolName}_${i}`)) i++;
        warnings.push(`${operationId}: duplicate tool name ${toolName}, using ${toolName}_${i}`);
        toolName = `${toolName}_${i}`;
      }
      toolNames.add(toolName);

      const summary =
        operation.summary ||
        (operation.description ?? "").split("\n")[0] ||
        operationId;

      operations.push({
        operationId,
        toolName,
        method: method.toUpperCase(),
        path,
        tag: (operation.tags ?? ["Misc"])[0],
        summary,
        description: operation.description,
        deprecated: operation.deprecated === true,
        mutation: method.toLowerCase() !== "get",
        readOnly: method.toLowerCase() === "get" || method.toLowerCase() === "head",
        params,
        ...(body ? { body } : {}),
        responseContentTypes: responseContentTypes(operation),
      });
    }
  }

  operations.sort((a, b) => a.toolName.localeCompare(b.toolName));

  const manifest = {
    apiVersion: spec.info?.version ?? "unknown",
    specificationVersion: spec.openapi ?? "3.1",
    specHash,
    source: "https://github.com/immich-app/immich open-api/immich-openapi-specs.json",
    operations,
    schemas,
  };

  await mkdir(dirname(outFile), { recursive: true });
  const output = [
    "// @ts-nocheck",
    "/* eslint-disable */",
    "// AUTO-GENERATED by scripts/generate.mjs - DO NOT EDIT.",
    `// Immich API ${manifest.apiVersion}, ${operations.length} operations.`,
    'import type { Manifest } from "../types.js";',
    "",
    `export const manifest = ${JSON.stringify(manifest)} as unknown as Manifest;`,
    "",
  ].join("\n");
  await writeFile(outFile, output);

  console.log(`Generated ${operations.length} operations -> ${outFile}`);
  console.log(`  API version: ${manifest.apiVersion}, schemas: ${Object.keys(schemas).length}, spec: ${specHash}`);
  if (warnings.length) {
    console.warn(`\n${warnings.length} warning(s):`);
    for (const warning of warnings) console.warn(`  ! ${warning}`);
  } else {
    console.log("  SDK cross-check: OK");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
