import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PathGuard } from "../security/pathGuard.js";
import { textResult, toErrorResult } from "./helpers.js";

// --- Primitivas de escritura (exportadas para tests) -------------------------

/** Escritura atomica: fichero temporal + rename (evita ficheros a medias). */
export function atomicWrite(abs: string, content: string): void {
  const dir = path.dirname(abs);
  const tmp = path.join(
    dir,
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, abs);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* limpieza best-effort */
    }
    throw err;
  }
}

/**
 * Mueve una nota (ruta absoluta ya validada) a la papelera interna `.trash`
 * dentro de la boveda. Reversible. Evita colisiones con un sufijo temporal.
 * Devuelve la ruta relativa (con '/') del destino en la papelera.
 */
export function moveToTrash(guard: PathGuard, safeAbs: string): string {
  const trashDir = guard.trashRoot;
  fs.mkdirSync(trashDir, { recursive: true });
  const base = path.basename(safeAbs);
  let dest = path.join(trashDir, base);
  if (fs.existsSync(dest)) {
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    dest = path.join(trashDir, `${stem}-${Date.now()}${ext}`);
  }
  fs.renameSync(safeAbs, dest);
  return path.relative(guard.root, dest).split(path.sep).join("/");
}

// --- Registro de herramientas ------------------------------------------------

/** Registra las 4 herramientas de escritura. Solo se llama si enableWrite=true. */
export function registerWriteTools(server: McpServer, guard: PathGuard): void {
  server.registerTool(
    "create_note",
    {
      title: "Crear nota",
      description:
        "Crea una nota .md nueva en la boveda con el contenido dado. " +
        "FALLA si la nota ya existe (no sobrescribe). Ruta relativa a la boveda.",
      inputSchema: {
        path: z.string().min(1).describe("Ruta relativa de la nota .md a crear."),
        content: z.string().describe("Contenido Markdown de la nota."),
      },
    },
    async ({ path: notePath, content }) => {
      try {
        const safe = guard.resolveSafeWritePath(notePath);
        fs.mkdirSync(path.dirname(safe), { recursive: true });
        try {
          fs.writeFileSync(safe, content, { encoding: "utf8", flag: "wx" });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EEXIST") {
            return {
              content: [
                {
                  type: "text",
                  text: `La nota ya existe: ${notePath}. Usa update_note o append_note.`,
                },
              ],
              isError: true,
            };
          }
          throw e;
        }
        return textResult(`Nota creada: ${notePath}`);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "update_note",
    {
      title: "Actualizar nota",
      description:
        "Reemplaza (sobrescribe) el contenido completo de una nota .md existente. " +
        "Escritura atomica. FALLA si la nota no existe. Ruta relativa a la boveda.",
      inputSchema: {
        path: z.string().min(1).describe("Ruta relativa de la nota .md a actualizar."),
        content: z.string().describe("Nuevo contenido Markdown completo."),
      },
    },
    async ({ path: notePath, content }) => {
      try {
        const safe = guard.resolveSafeWritePath(notePath);
        if (!fs.existsSync(safe) || !fs.statSync(safe).isFile()) {
          return {
            content: [
              {
                type: "text",
                text: `La nota no existe: ${notePath}. Usa create_note para crearla.`,
              },
            ],
            isError: true,
          };
        }
        atomicWrite(safe, content);
        return textResult(`Nota actualizada: ${notePath}`);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "append_note",
    {
      title: "Anadir a nota",
      description:
        "Anade texto al final de una nota .md existente, sin tocar el contenido previo. " +
        "FALLA si la nota no existe. Ruta relativa a la boveda.",
      inputSchema: {
        path: z.string().min(1).describe("Ruta relativa de la nota .md."),
        text: z.string().describe("Texto a anadir al final de la nota."),
      },
    },
    async ({ path: notePath, text }) => {
      try {
        const safe = guard.resolveSafeWritePath(notePath);
        if (!fs.existsSync(safe) || !fs.statSync(safe).isFile()) {
          return {
            content: [
              { type: "text", text: `La nota no existe: ${notePath}.` },
            ],
            isError: true,
          };
        }
        fs.appendFileSync(safe, text, "utf8");
        return textResult(`Texto anadido a: ${notePath}`);
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );

  server.registerTool(
    "delete_note",
    {
      title: "Borrar nota (a papelera)",
      description:
        "Mueve una nota .md a la papelera interna '.trash' de la boveda (reversible, " +
        "NO es un borrado permanente). Ruta relativa a la boveda.",
      inputSchema: {
        path: z.string().min(1).describe("Ruta relativa de la nota .md a borrar."),
      },
    },
    async ({ path: notePath }) => {
      try {
        // Reutiliza el guardian de lectura: exige que exista y sea .md.
        const safe = guard.resolveSafePath(notePath, { requireMarkdown: true });
        if (!fs.statSync(safe).isFile()) {
          return {
            content: [
              { type: "text", text: `La ruta no es un archivo: ${notePath}` },
            ],
            isError: true,
          };
        }
        const dest = moveToTrash(guard, safe);
        return textResult(
          `Nota movida a la papelera: ${notePath} -> ${dest}`,
        );
      } catch (err) {
        return toErrorResult(err);
      }
    },
  );
}
