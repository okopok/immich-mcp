#!/usr/bin/env node
/**
 * Downloads the Immich OpenAPI specification and the generated `@immich/sdk`
 * type declarations into ./spec.
 *
 * The specification version MUST match the published `@immich/sdk` version used
 * by this project, otherwise parameter names and operation ids will drift.
 *
 * Usage:
 *   node scripts/fetch-spec.mjs            # uses the version from package.json
 *   node scripts/fetch-spec.mjs 3.2.4
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const specDir = resolve(root, "spec");

async function sdkVersionFromPackageJson() {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  return pkg.dependencies["@immich/sdk"].replace(/^[\^~]/, "");
}

/**
 * Prefers the actually installed `@immich/sdk` version so that
 * `npm install @immich/sdk@latest` automatically feeds the right spec version.
 */
async function resolvedSdkVersion() {
  try {
    const pkg = JSON.parse(
      await readFile(resolve(root, "node_modules/@immich/sdk/package.json"), "utf8"),
    );
    if (pkg.version) return pkg.version;
  } catch {
    // fall through to the declared range
  }
  return sdkVersionFromPackageJson();
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function main() {
  const version = process.argv[2] ?? (await resolvedSdkVersion());
  await mkdir(specDir, { recursive: true });

  const specUrl = `https://raw.githubusercontent.com/immich-app/immich/v${version}/open-api/immich-openapi-specs.json`;
  const dtsUrl = `https://unpkg.com/@immich/sdk@${version}/build/fetch-client.d.ts`;

  console.log(`Fetching OpenAPI spec  : ${specUrl}`);
  const spec = await download(specUrl);
  await writeFile(resolve(specDir, "immich-openapi-specs.json"), spec);

  console.log(`Fetching SDK d.ts      : ${dtsUrl}`);
  const dts = await download(dtsUrl);
  await writeFile(resolve(specDir, "sdk-client.d.ts"), dts);

  console.log(`Saved to ${specDir} (immich ${version})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
