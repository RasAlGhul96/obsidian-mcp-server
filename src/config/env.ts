import fs from "node:fs";
import path from "node:path";

export interface ServerConfig {
  /** Ruta absoluta y canonica (realpath) a la raiz de la boveda. */
  readonly vaultRoot: string;
  readonly logLevel: string;
}

/**
 * Carga y valida la configuracion desde variables de entorno.
 * Aplica fail-fast: si OBSIDIAN_VAULT_PATH falta, no es absoluta,
 * no existe o no es un directorio, el proceso NO debe arrancar.
 *
 * Claude Desktop inyecta estas variables mediante el campo "env" de
 * claude_desktop_config.json, por lo que no se necesita dotenv.
 */
export function loadConfig(): ServerConfig {
  const raw = process.env.OBSIDIAN_VAULT_PATH;

  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "OBSIDIAN_VAULT_PATH no esta definida. Configura la ruta absoluta a tu boveda de Obsidian.",
    );
  }

  const candidate = raw.trim();

  if (!path.isAbsolute(candidate)) {
    throw new Error(
      `OBSIDIAN_VAULT_PATH debe ser una ruta ABSOLUTA. Recibido: ${candidate}`,
    );
  }

  // Resolver a su forma canonica (sigue symlinks) para tener una raiz
  // estable de comparacion y detectar de inmediato rutas inaccesibles.
  let vaultRoot: string;
  try {
    vaultRoot = fs.realpathSync(candidate);
  } catch {
    throw new Error(
      `OBSIDIAN_VAULT_PATH no existe o no es accesible: ${candidate}`,
    );
  }

  const stat = fs.statSync(vaultRoot);
  if (!stat.isDirectory()) {
    throw new Error(`OBSIDIAN_VAULT_PATH no es un directorio: ${vaultRoot}`);
  }

  const logLevel = process.env.LOG_LEVEL?.trim() || "info";

  return { vaultRoot, logLevel };
}
