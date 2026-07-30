import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PathGuard } from "../security/pathGuard.js";
import { textResult, toErrorResult } from "./helpers.js";
import { collectMarkdown } from "./vaultWalker.js";

export function registerListNotes(server: McpServer, guard: PathGuard): void {
  server.registerTool(
    "list_notes",
    {
      title: "Listar notas",
      description:
        "Lista (recursivamente) las notas .md de la boveda de Obsidian. " +
        "Opcionalmente restringe a una subcarpeta relativa. " +
        "Ignora carpetas ocultas como .obsidian. Solo lectura.",
      inputSchema: {
        folder: z
          .string()
          .optional()
          .describe("Subcarpeta relativa a la boveda. Vacio = raiz de la boveda."),
      },
    },
    async ({ folder }) => {
      try {
        let startAbs = guard.root;
        let startRel = "";

        if (folder !== undefined && folder.trim() !== "") {
          startAbs = guard.resolveSafePath(folder, { requireMarkdown: false });
          startRel = path.relative(guard.root, startAbs);
          const stat = fs.statSync(startAbs);
          if (!stat.isDirectory()) {
            return {
              content: [
                { type: "text", text: `La ruta no es un directorio: ${folder}` },
              ],
              isError: true,
            };
          }
        }

        const notes = collectMarkdown(guard, startAbs, startRel);
        const header = folder ? `Notas en '${folder}'` : "Notas en la boveda";
        const text = notes.length
          ? `${header} (${notes.length}):\n\n${notes.join("\n")}`
          : `${header}: (sin notas)`;
        return textResult(text);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
