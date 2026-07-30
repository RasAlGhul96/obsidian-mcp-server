import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PathSecurityError } from "../security/pathGuard.js";

/** Respuesta de texto simple para el modelo. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Convierte cualquier error en una respuesta estructurada de herramienta.
 * Los PathSecurityError se exponen con su codigo; el resto se degrada a un
 * mensaje generico sin filtrar detalles internos.
 */
export function toErrorResult(err: unknown): CallToolResult {
  if (err instanceof PathSecurityError) {
    return {
      content: [
        { type: "text", text: `Acceso denegado [${err.code}]: ${err.message}` },
      ],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
