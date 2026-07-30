# Obsidian MCP Server (Zero Trust · Solo lectura)

Servidor MCP en TypeScript que conecta Claude Desktop con una boveda local de Obsidian
bajo un modelo de **Confianza Cero**. Todas las herramientas de esta fase inicial son
**estrictamente de solo lectura**.

## Herramientas expuestas

| Herramienta    | Tipo        | Descripcion                                          |
|----------------|-------------|------------------------------------------------------|
| `read_note`    | solo lectura | Lee el contenido de una nota `.md` de la boveda.     |
| `list_notes`   | solo lectura | Lista las notas de la boveda (o de una subcarpeta).  |
| `search_vault` | solo lectura | Busca texto dentro de las notas de la boveda.        |

## Modelo de seguridad (Zero Trust)

El servidor asume que **toda ruta recibida es hostil** hasta ser demostrada segura.
El unico limite de confianza es `OBSIDIAN_VAULT_PATH` (ruta absoluta).

Garantias del sandbox:

1. **Anti path traversal** — se resuelve la ruta a su forma canonica absoluta y se
   verifica que siga estando *dentro* de la boveda. Se bloquea `../../etc/passwd`,
   `..\\..\\.ssh\\id_rsa`, rutas absolutas externas, null bytes, etc.
2. **Ocultos ignorados** — cualquier segmento que empiece por `.` (p. ej. `.obsidian`,
   `.git`, `.ssh`) queda vetado. La configuracion interna de Obsidian nunca es accesible.
   Ademas se rechaza `:` (unidad relativa `C:foo` y flujos de datos alternativos NTFS).
3. **Enlaces simbolicos confinados** — se resuelve el destino real del symlink
   (`fs.realpath`) y se rechaza si escapa de la boveda, evitando fugas por enlaces.
4. **Allowlist de extensiones** — solo se leen archivos `.md` (y `.markdown`).
5. **Un unico portero** — cada herramienta MUST pasar por el middleware `resolveSafePath`
   antes de tocar el disco. Ninguna herramienta accede al filesystem por su cuenta.

## Estructura del proyecto

```
MCP/
├── src/
│   ├── index.ts            # Entrypoint: crea el server MCP + transporte stdio (Fase 2)
│   ├── config/
│   │   └── env.ts          # Carga y valida OBSIDIAN_VAULT_PATH (Fase 2)
│   ├── security/
│   │   └── pathGuard.ts    # Middleware Zero Trust de validacion de rutas (Fase 2)
│   └── tools/
│       ├── readNote.ts     # Herramienta read_note (Fase 2)
│       ├── listNotes.ts    # Herramienta list_notes (Fase 2)
│       └── searchVault.ts  # Herramienta search_vault (Fase 2)
├── tests/
│   └── security.test.ts    # Red Team: intentos de path traversal, ocultos, symlinks (Fase 3)
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

## Diseno del middleware de seguridad: `resolveSafePath`

Contrato de la funcion central que blindara cada herramienta en la Fase 2:

```
resolveSafePath(relativeInput: string): string  // devuelve ruta absoluta segura o LANZA error
```

Pipeline de validacion (falla-cerrado, se rechaza ante cualquier duda):

1. **Normalizar entrada** — rechazar si contiene `\0` (null byte) o esta vacia.
2. **Prohibir rutas absolutas del cliente** — el input siempre es *relativo a la boveda*.
   Se rechaza `path.isAbsolute(input)` y esquemas tipo `C:\`, `/`, `\\servidor`.
3. **Resolver contra la boveda** — `path.resolve(VAULT_ROOT, input)`.
4. **Verificar contencion** — la ruta resuelta debe empezar por `VAULT_ROOT + path.sep`
   (comparacion normalizada, case-insensitive en Windows). Si no, `PATH_ESCAPE`.
5. **Vetar segmentos ocultos** — dividir la ruta relativa por separador y rechazar si
   algun segmento empieza por `.`.
6. **Resolver symlinks reales** — `fs.realpathSync` del destino y repetir el paso 4
   sobre la ruta real. Si el enlace apunta fuera, `SYMLINK_ESCAPE`.
7. **Validar extension** — para lecturas de archivo, exigir `.md` / `.markdown`.

Errores estructurados (nunca stack traces crudos al modelo):
`PATH_ESCAPE`, `HIDDEN_SEGMENT`, `SYMLINK_ESCAPE`, `INVALID_EXTENSION`, `NOT_FOUND`.

## Requisitos

- Node.js >= 20
- Una boveda de Obsidian local

## Estado

- [x] Fase 1 — Arquitectura y entorno
- [x] Fase 2 — Core y herramientas
- [x] Fase 3 — Red Team y tests de seguridad (18/18)
- [x] Fase 4 — Despliegue e integracion
