# Politica de Seguridad

## Modelo de amenaza

Este servidor MCP opera bajo **Confianza Cero (Zero Trust)**: toda ruta recibida se
considera hostil hasta demostrarse segura. El unico limite de confianza es la variable
`OBSIDIAN_VAULT_PATH`. Es **solo lectura por defecto**; la escritura (`create_note`,
`update_note`, `append_note`, `delete_note`) es **opt-in** via `OBSIDIAN_ENABLE_WRITE=true`
y pasa por el mismo guardian (`resolveSafeWritePath`), con borrado reversible a `.trash`.

Garantias del sandbox (`src/security/pathGuard.ts`):

- Anti path traversal (`../`, `..\`) — contencion verificada sobre la ruta canonica.
- Rechazo de rutas absolutas del cliente (POSIX, unidad Windows, UNC).
- Rechazo de `:` — unidad relativa (`C:foo`) y flujos de datos alternativos NTFS.
- Segmentos ocultos vetados (`.obsidian`, `.git`, `.ssh`, ...).
- Enlaces simbolicos / junctions confinados: se resuelve `realpath` y se re-verifica.
- Allowlist de extension (`.md`, `.markdown`) para lecturas de archivo.
- Rechazo de bytes nulos y entradas vacias.

La cobertura de estos controles se verifica en `tests/security.test.ts`.

## Buenas practicas de despliegue

- No comitees tu archivo `.env` (esta en `.gitignore`). Usa `.env.example` como plantilla.
- `OBSIDIAN_VAULT_PATH` debe apuntar SOLO a tu boveda, nunca a la raiz del disco ni al home.
- Manten las dependencias actualizadas (`npm audit` debe reportar 0 vulnerabilidades).

## Reportar una vulnerabilidad

Si encuentras un problema de seguridad, abre un *issue privado* (o de seguridad) en el
repositorio con pasos de reproduccion. No publiques exploits antes de una correccion.
