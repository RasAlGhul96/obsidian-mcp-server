#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config/env.js";
import { PathGuard } from "./security/pathGuard.js";
import { registerReadNote } from "./tools/readNote.js";
import { registerListNotes } from "./tools/listNotes.js";
import { registerSearchVault } from "./tools/searchVault.js";
import { registerWriteTools } from "./tools/writeTools.js";

async function main(): Promise<void> {
  // Fail-fast: si la boveda no es valida, el proceso no arranca.
  const config = loadConfig();
  const guard = new PathGuard(config.vaultRoot);

  const server = new McpServer({
    name: "obsidian-mcp-server",
    version: "0.1.0",
  });

  // Cada herramienta recibe el mismo guardian; ninguna toca disco sin el.
  registerReadNote(server, guard);
  registerListNotes(server, guard);
  registerSearchVault(server, guard);

  // Escritura: opt-in. Solo se registra si OBSIDIAN_ENABLE_WRITE esta activo.
  if (config.enableWrite) {
    registerWriteTools(server, guard);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // IMPORTANTE: stdout es el canal del protocolo MCP. Todo log va a stderr.
  const mode = config.enableWrite ? "lectura/escritura" : "solo lectura";
  console.error(`[obsidian-mcp] Servidor listo (${mode}). Boveda: ${guard.root}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[obsidian-mcp] Error fatal: ${message}`);
  process.exit(1);
});
