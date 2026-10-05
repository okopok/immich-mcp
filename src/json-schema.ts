import { z } from "zod";
import type { JsonSchema } from "./types.js";

/**
 * Converts the JSON Schema dialect used by the Immich OpenAPI specification into
 * Zod schemas suitable for MCP tool input definitions.
 *
 * `$ref`s are resolved lazily and memoised, which makes recursive schemas safe.
 */
export interface ZodFidelityContext {
  schemas: Record<string, JsonSchema>;
  cache: Map<string, z.ZodTypeAny>;
}

export function createZodContext(schemas: Record<string, JsonSchema>): ZodFidelityContext {
  return { schemas, cache: new Map() };
}

const FORMAT_REFINEMENTS: Record<string, (schema: z.ZodString) => z.ZodTypeAny> = {
  uuid: (schema) => schema.uuid(),
  email: (schema) => schema.email(),
  uri: (schema) => schema.url(),
  url: (schema) => schema.url(),
};

function describe(type: z.ZodTypeAny, schema: JsonSchema): z.ZodTypeAny {
  const parts: string[] = [];
  if (schema.description) parts.push(schema.description);
  if (schema.format && !["binary", "base64"].includes(schema.format)) parts.push(`format: ${schema.format}`);
  if (schema.example !== undefined) parts.push(`example: ${JSON.stringify(schema.example)}`);
  if (schema.default !== undefined) parts.push(`default: ${JSON.stringify(schema.default)}`);
  if (parts.length === 0) return type;
  return type.describe(parts.join(" | "));
}

function applyDefault(type: z.ZodTypeAny, schema: JsonSchema): z.ZodTypeAny {
  if (schema.default === undefined) return type;
  try {
    return type.default(schema.default as never);
  } catch {
    return type;
  }
}

function refKey(schema: JsonSchema): string | undefined {
  if (typeof schema.$ref !== "string") return undefined;
  return schema.$ref.split("/").pop();
}

function buildRef(ctx: ZodFidelityContext, name: string): z.ZodTypeAny {
  const cached = ctx.cache.get(name);
  if (cached) return cached;

  // Placeholder so recursive references resolve to the same schema instance.
  const holder: { value?: z.ZodTypeAny } = {};
  const lazy = z.lazy(() => holder.value ?? z.unknown());
  ctx.cache.set(name, lazy);

  const target = ctx.schemas[name] ?? {};
  holder.value = build(target, ctx, 0);
  ctx.cache.set(name, holder.value);
  return holder.value;
}

function buildEnum(schema: JsonSchema): z.ZodTypeAny | undefined {
  const values = schema.enum;
  if (!Array.isArray(values) || values.length === 0) return undefined;
  if (values.every((value) => typeof value === "string")) {
    if (values.length === 1) return z.literal(values[0] as string);
    return z.enum(values as [string, ...string[]]);
  }
  const literals = values.map((value) => z.literal(value as never));
  return literals.length === 1
    ? literals[0]!
    : z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function buildString(schema: JsonSchema): z.ZodTypeAny {
  let type: z.ZodTypeAny = z.string();
  const refinement = schema.format ? FORMAT_REFINEMENTS[schema.format] : undefined;
  if (refinement && !schema.pattern) {
    type = refinement(type as z.ZodString);
  }
  if (typeof schema.minLength === "number") type = (type as z.ZodString).min(schema.minLength);
  if (typeof schema.maxLength === "number") type = (type as z.ZodString).max(schema.maxLength);
  if (schema.pattern) {
    // Informational only: Immich patterns are strict and often include anchors,
    // so surfacing them in the description is safer than enforcing them.
    type = type.describe(`pattern: ${schema.pattern}`);
  }
  return type;
}

function buildNumber(schema: JsonSchema, integer: boolean): z.ZodTypeAny {
  let type: z.ZodNumber = integer ? z.number().int() : z.number();
  if (typeof schema.minimum === "number") type = type.min(schema.minimum);
  if (typeof schema.maximum === "number") type = type.max(schema.maximum);
  return type;
}

function buildArray(schema: JsonSchema, ctx: ZodFidelityContext, depth: number): z.ZodTypeAny {
  const itemSchema = schema.items && typeof schema.items === "object" ? schema.items : undefined;
  const items = itemSchema ? build(itemSchema, ctx, depth + 1) : z.unknown();
  let type = z.array(items);
  if (typeof schema.minItems === "number") type = type.min(schema.minItems);
  if (typeof schema.maxItems === "number") type = type.max(schema.maxItems);
  return type;
}

function buildObject(schema: JsonSchema, ctx: ZodFidelityContext, depth: number): z.ZodTypeAny {
  const properties = schema.properties ?? {};
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(schema.required ?? []);
  for (const [key, value] of Object.entries(properties)) {
    const child = build(value, ctx, depth + 1);
    shape[key] = required.has(key) ? child : child.optional();
  }
  const additional = schema.additionalProperties;
  if (Object.keys(shape).length === 0) {
    if (additional && typeof additional === "object") {
      return z.record(build(additional, ctx, depth + 1));
    }
    return z.record(z.unknown());
  }
  const object = z.object(shape);
  return additional === false ? object : object.passthrough();
}

function buildComposition(schema: JsonSchema, ctx: ZodFidelityContext, depth: number): z.ZodTypeAny | undefined {
  const variants = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(variants) && variants.length > 0) {
    const types = variants.map((variant) => build(variant, ctx, depth + 1));
    if (types.length === 1) return types[0]!;
    return z.union(types as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const types = schema.allOf.map((variant) => build(variant, ctx, depth + 1));
    const objects = types.filter((type): type is z.ZodObject<z.ZodRawShape> => type instanceof z.ZodObject);
    if (objects.length === types.length && objects.length > 0) {
      let merged = objects[0]!;
      for (const object of objects.slice(1)) merged = merged.merge(object);
      return merged;
    }
    return types.reduce((acc, type) => z.intersection(acc, type));
  }
  return undefined;
}

function build(schema: JsonSchema, ctx: ZodFidelityContext, depth: number): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.unknown();
  if (depth > 12) return z.unknown();

  if (schema.$ref) {
    const name = refKey(schema);
    if (name) return buildRef(ctx, name);
  }

  if (schema.const !== undefined) {
    return z.literal(schema.const as never);
  }

  const enumType = buildEnum(schema);
  if (enumType) return applyDefault(describe(enumType, schema), schema);

  const composition = buildComposition(schema, ctx, depth);
  if (composition) return describe(maybeNullable(composition, schema), schema);

  const rawType = schema.type;
  const types = Array.isArray(rawType) ? rawType : rawType ? [rawType] : [];
  const nonNull = types.filter((type) => type !== "null");

  let result: z.ZodTypeAny | undefined;
  if (nonNull.length === 1) {
    const type = nonNull[0]!;
    if (type === "string") result = buildString(schema);
    else if (type === "integer") result = buildNumber(schema, true);
    else if (type === "number") result = buildNumber(schema, false);
    else if (type === "boolean") result = z.boolean();
    else if (type === "array") result = buildArray(schema, ctx, depth);
    else if (type === "object") result = buildObject(schema, ctx, depth);
  } else if (nonNull.length > 1) {
    const variants = nonNull.map((type) => build({ ...schema, type }, ctx, depth + 1));
    result = z.union(variants as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  } else if (schema.properties) {
    result = buildObject(schema, ctx, depth);
  }

  if (!result) result = z.unknown();
  result = maybeNullable(result, schema);
  return applyDefault(describe(result, schema), schema);
}

function maybeNullable(type: z.ZodTypeAny, schema: JsonSchema): z.ZodTypeAny {
  const nullable = schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes("null"));
  return nullable ? type.nullable() : type;
}

export function jsonSchemaToZod(schema: JsonSchema, ctx: ZodFidelityContext): z.ZodTypeAny {
  try {
    return build(schema, ctx, 0);
  } catch {
    return z.unknown();
  }
}
