import fs from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PathGuard } from "../security/pathGuard.js";
import { textResult, toErrorResult } from "./helpers.js";
import { collectMarkdown } from "./vaultWalker.js";

const DEFAULT_MAX_RESULTS = 50;
const SNIPPET_LENGTH = 200;
/** No leer en memoria notas mayores de 5 MB (defensa OOM/DoS). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function registerSearchVault(server: McpServer, guard: PathGuard): void {
  server.registerTool(
    "search_vault",
    {
      title: "Buscar en la boveda",
      description:
        "Busca una cadena de texto (sin distinguir mayusculas/minusculas) en las notas " +
        ".md de la boveda y devuelve las coincidencias con su ubicacion (nota:linea). Solo lectura.",
      inputSchema: {
        query: z.string().min(1).describe("Texto a buscar."),
        maxResults: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Maximo de coincidencias a devolver (por defecto 50)."),
      },
    },
    async ({ query, maxResults }) => {
      try {
        const limit = maxResults ?? DEFAULT_MAX_RESULTS;
        const needle = query.toLowerCase();
        const relFiles = collectMarkdown(guard, guard.root, "");
        const results: string[] = [];

        outer: for (const rel of relFiles) {
          let abs: string;
          try {
            // Revalidar cada archivo antes de leerlo.
            abs = guard.resolveSafePath(rel, { requireMarkdown: true });
          } catch {
            continue;
          }

          let content: string;
          try {
            if (fs.statSync(abs).size > MAX_FILE_BYTES) continue;
            content = fs.readFileSync(abs, "utf8");
          } catch {
            continue;
          }

          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? "";
            if (line.toLowerCase().includes(needle)) {
              const snippet = line.trim().slice(0, SNIPPET_LENGTH);
              results.push(`${rel}:${i + 1}: ${snippet}`);
              if (results.length >= limit) break outer;
            }
          }
        }

        const text = results.length
          ? `${results.length} coincidencia(s) para "${query}":\n\n${results.join("\n")}`
          : `Sin coincidencias para "${query}".`;
        return textResult(text);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
