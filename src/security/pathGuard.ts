import fs from "node:fs";
import path from "node:path";

export type PathErrorCode =
  | "EMPTY_INPUT"
  | "NULL_BYTE"
  | "INVALID_CHARACTER"
  | "ABSOLUTE_INPUT"
  | "PATH_ESCAPE"
  | "HIDDEN_SEGMENT"
  | "SYMLINK_ESCAPE"
  | "INVALID_EXTENSION"
  | "NOT_FOUND";

/**
 * Error estructurado de seguridad. Nunca se filtran stack traces crudos
 * al modelo; solo un codigo interpretable y un mensaje claro.
 */
export class PathSecurityError extends Error {
  constructor(
    public readonly code: PathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PathSecurityError";
  }
}

const ALLOWED_EXTENSIONS = new Set([".md", ".markdown"]);
const isWindows = process.platform === "win32";

export interface ResolveOptions {
  /** Exigir que el destino final sea un archivo .md/.markdown (por defecto true). */
  requireMarkdown?: boolean;
}

/**
 * Guardian de rutas Zero Trust. Toda ruta recibida se considera hostil
 * hasta demostrarse segura. El unico limite de confianza es `vaultRoot`.
 *
 * REGLA DE ORO: ninguna herramienta debe tocar el disco sin pasar antes
 * por `resolveSafePath`.
 */
export class PathGuard {
  private readonly vaultRoot: string;
  private readonly vaultRootWithSep: string;

  /** @param vaultRoot Ruta absoluta canonica (ya pasada por realpath). */
  constructor(vaultRoot: string) {
    this.vaultRoot = path.resolve(vaultRoot);
    this.vaultRootWithSep = this.vaultRoot.endsWith(path.sep)
      ? this.vaultRoot
      : this.vaultRoot + path.sep;
  }

  get root(): string {
    return this.vaultRoot;
  }

  /** Normaliza para comparacion (case-insensitive en Windows). */
  private norm(p: string): string {
    return isWindows ? p.toLowerCase() : p;
  }

  /** ¿La ruta absoluta esta contenida dentro de la boveda? */
  private isContained(absolute: string): boolean {
    const a = this.norm(absolute);
    return (
      a === this.norm(this.vaultRoot) ||
      a.startsWith(this.norm(this.vaultRootWithSep))
    );
  }

  /** Lanza si algun segmento de la ruta relativa empieza por '.'. */
  private assertNoHiddenSegments(relative: string, context: string): void {
    const segments = relative.split(/[\\/]+/).filter((s) => s.length > 0);
    for (const seg of segments) {
      if (seg.startsWith(".")) {
        throw new PathSecurityError(
          "HIDDEN_SEGMENT",
          `Segmento oculto no permitido${context}: ${seg}`,
        );
      }
    }
  }

  /**
   * Resuelve una entrada RELATIVA a la boveda a una ruta absoluta segura,
   * o LANZA un PathSecurityError. Falla-cerrado ante cualquier duda.
   */
  resolveSafePath(relativeInput: string, options: ResolveOptions = {}): string {
    const requireMarkdown = options.requireMarkdown ?? true;

    // 1. Higiene basica de la entrada.
    if (typeof relativeInput !== "string" || relativeInput.trim() === "") {
      throw new PathSecurityError("EMPTY_INPUT", "La ruta esta vacia.");
    }
    if (relativeInput.includes("\0")) {
      throw new PathSecurityError("NULL_BYTE", "La ruta contiene un byte nulo.");
    }

    // 1b. Rechazar ':' -> cubre unidad relativa de Windows (C:foo), especificador
    //     de unidad y flujos de datos alternativos NTFS (nota.md:flujo_oculto).
    //     Los nombres de nota legitimos no contienen ':'.
    if (relativeInput.includes(":")) {
      throw new PathSecurityError(
        "INVALID_CHARACTER",
        "La ruta contiene ':' (unidad o flujo de datos alternativo no permitido).",
      );
    }

    // 1c. Normalizar separadores: tratar '\' como '/' en TODAS las plataformas.
    //     Asi un traversal estilo Windows (..\..\) se detecta identico en
    //     Linux/macOS (donde '\' no es separador) y en Windows. Comportamiento
    //     determinista, imprescindible en una herramienta de seguridad.
    const normalized = relativeInput.replace(/\\/g, "/");

    // 2. Prohibir rutas absolutas del cliente (POSIX y UNC).
    if (path.isAbsolute(normalized) || normalized.startsWith("//")) {
      throw new PathSecurityError(
        "ABSOLUTE_INPUT",
        "Solo se permiten rutas relativas a la boveda.",
      );
    }

    // 3. Resolver contra la raiz de la boveda.
    const resolved = path.resolve(this.vaultRoot, normalized);

    // 4. Contencion lexica.
    if (!this.isContained(resolved)) {
      throw new PathSecurityError(
        "PATH_ESCAPE",
        "La ruta escapa de la boveda.",
      );
    }

    // 5. Vetar segmentos ocultos en la porcion relativa.
    this.assertNoHiddenSegments(path.relative(this.vaultRoot, resolved), "");

    // 6. Resolver enlaces simbolicos y re-verificar contencion + ocultos.
    let real: string;
    try {
      real = fs.realpathSync(resolved);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw new PathSecurityError("NOT_FOUND", "La ruta no existe.");
      }
      throw err;
    }
    if (!this.isContained(real)) {
      throw new PathSecurityError(
        "SYMLINK_ESCAPE",
        "Un enlace simbolico apunta fuera de la boveda.",
      );
    }
    this.assertNoHiddenSegments(
      path.relative(this.vaultRoot, real),
      " (destino real)",
    );

    // 7. Allowlist de extension (solo para lecturas de archivo).
    if (requireMarkdown) {
      const ext = path.extname(real).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new PathSecurityError(
          "INVALID_EXTENSION",
          `Extension no permitida: ${ext || "(ninguna)"}`,
        );
      }
    }

    return real;
  }
}
