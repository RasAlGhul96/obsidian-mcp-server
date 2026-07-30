import fs from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PathGuard } from "../security/pathGuard.js";
import { textResult, toErrorResult } from "./helpers.js";

export function registerReadNote(server: McpServer, guard: PathGuard): void {
  server.registerTool(
    "read_note",
    {
      title: "Leer nota",
      description:
        "Lee el contenido de una nota Markdown de la boveda de Obsidian. " +
        "La ruta es relativa a la raiz de la boveda (p. ej. 'Proyectos/idea.md'). Solo lectura.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Ruta relativa a la boveda de la nota .md a leer."),
      },
    },
    async ({ path: notePath }) => {
      try {
        // El guardian valida ANTES de cualquier acceso a disco.
        const safe = guard.resolveSafePath(notePath, { requireMarkdown: true });
        if (!fs.statSync(safe).isFile()) {
          return {
            content: [
              { type: "text", text: `La ruta no es un archivo: ${notePath}` },
            ],
            isError: true,
          };
        }
        const content = fs.readFileSync(safe, "utf8");
        return textResult(content);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
