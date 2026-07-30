import fs from "node:fs";
import path from "node:path";
import type { PathGuard } from "../security/pathGuard.js";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

/**
 * Recorre la boveda a partir de un directorio ya validado y devuelve las
 * rutas relativas (con '/') de todas las notas Markdown, ordenadas.
 *
 * Seguridad: cada entrada vuelve a pasar por el guardian, de modo que las
 * carpetas ocultas y los symlinks que escapan se descartan silenciosamente.
 */
export function collectMarkdown(
  guard: PathGuard,
  startAbs: string,
  startRel: string,
): string[] {
  const acc: string[] = [];
  walk(guard, startAbs, startRel, acc);
  acc.sort();
  return acc;
}

function walk(
  guard: PathGuard,
  absDir: string,
  relDir: string,
  acc: string[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    // Ignorar ocultos de raiz (defensa temprana; el guardian tambien lo hace).
    if (entry.name.startsWith(".")) continue;

    const rel = relDir ? path.join(relDir, entry.name) : entry.name;

    // Revalidar SIEMPRE con el guardian (symlink-safe, anti-escape).
    let safe: string;
    try {
      safe = guard.resolveSafePath(rel, { requireMarkdown: false });
    } catch {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(safe);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walk(guard, safe, rel, acc);
    } else if (stat.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (MARKDOWN_EXTENSIONS.has(ext)) {
        acc.push(rel.split(path.sep).join("/"));
      }
    }
  }
}
