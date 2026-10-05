/**
 * Types shared between the code generator (scripts/generate.mjs) and the runtime.
 *
 * The generator emits `src/generated/manifest.ts`, which is a plain data structure
 * describing every operation exposed by the Immich OpenAPI specification together
 * with the exact parameter names expected by `@immich/sdk`.
 */

/** A minimally typed JSON Schema node (OpenAPI 3.1 dialect). */
export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  title?: string;
  default?: unknown;
  example?: unknown;
  enum?: unknown[];
  const?: unknown;
  nullable?: boolean;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema | false;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  [key: string]: unknown;
}

export type ParamLocation = "path" | "query" | "header";

export interface ParamManifest {
  /** Parameter name as it appears in the OpenAPI specification (used as the MCP input key). */
  name: string;
  /** Parameter name as expected by the generated `@immich/sdk` function. */
  sdkName: string;
  in: ParamLocation;
  required: boolean;
  schema: JsonSchema;
  description?: string;
}

export interface BodyManifest {
  /** Parameter name expected by the `@immich/sdk` function (e.g. `metadataSearchDto`). */
  sdkName: string;
  /** Schema of the whole request body (usually a `$ref`). */
  schema: JsonSchema;
  required: boolean;
  contentType: string;
  multipart: boolean;
  /**
   * When true the body object properties are flattened into the tool input
   * (so the caller passes the DTO fields directly instead of nested under `body`).
   */
  flattened: boolean;
  /** Resolved top-level properties (present when `flattened`). */
  properties?: Record<string, JsonSchema>;
  /** Required property names (present when `flattened`). */
  requiredProperties?: string[];
  /** True when the body contains a `format: binary` field (file upload). */
  hasBinary: boolean;
}

export interface OperationManifest {
  operationId: string;
  /** MCP tool name, e.g. `immich_get_album_info`. */
  toolName: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  deprecated: boolean;
  /** True for anything other than GET. */
  mutation: boolean;
  /** Read-only operations (GET/HEAD). */
  readOnly: boolean;
  params: ParamManifest[];
  body?: BodyManifest;
  /** Response content types declared by the spec (e.g. application/json, application/octet-stream). */
  responseContentTypes: string[];
}

export interface Manifest {
  apiVersion: string;
  specificationVersion: string;
  /** SHA-256 of the source specification, so generation is reproducible/diffable. */
  specHash: string;
  source: string;
  operations: OperationManifest[];
  /** Component schemas referenced by operation parameters/bodies. */
  schemas: Record<string, JsonSchema>;
}
