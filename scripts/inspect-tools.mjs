import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
Object.assign(env, {
  IMMICH_BASE_URL: "http://127.0.0.1:2283/api",
  IMMICH_API_KEY: "x",
  IMMICH_MCP_LOG_LEVEL: "error",
});

const client = new Client({ name: "inspect", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env, stderr: "pipe" }),
);

const { tools } = await client.listTools();
const wanted = process.argv.slice(2);
for (const name of wanted) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    console.log(`### ${name}: NOT FOUND`);
    continue;
  }
  console.log(`### ${tool.name}`);
  console.log(`   ${tool.description.split("\n")[0]}`);
  console.log(JSON.stringify(tool.inputSchema, null, 2));
  console.log();
}
await client.close();
