import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// El codigo se importa desde `src/`. El script `pretest` compila src + tests
// con tsconfig.test.json hacia `build/`, y los tests se ejecutan sobre ese JS
// (portable en cualquier Node LTS, sin depender de type-stripping nativo).
import {
  PathGuard,
  PathSecurityError,
  type PathErrorCode,
  type ResolveOptions,
} from "../src/security/pathGuard.js";
import { collectMarkdown } from "../src/tools/vaultWalker.js";

// --- Fixture: una boveda temporal aislada ------------------------------------

let tmpRoot: string;
let vaultRoot: string;
let outsideDir: string;
let guard: PathGuard;
let symlinkAvailable = false;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-mcp-redteam-"));

  vaultRoot = path.join(tmpRoot, "vault");
  fs.mkdirSync(vaultRoot);

  // Notas legitimas.
  fs.writeFileSync(
    path.join(vaultRoot, "Nota.md"),
    "# Hola\nEsto es una nota del proyecto con una idea brillante.\n",
  );
  fs.mkdirSync(path.join(vaultRoot, "Proyectos"));
  fs.writeFileSync(
    path.join(vaultRoot, "Proyectos", "idea.md"),
    "Contenido anidado legitimo.\n",
  );

  // Config interna de Obsidian (oculta) -> nunca debe ser accesible.
  fs.mkdirSync(path.join(vaultRoot, ".obsidian"));
  fs.writeFileSync(path.join(vaultRoot, ".obsidian", "workspace"), "{secreto}");

  // Archivo no-markdown -> extension no permitida.
  fs.writeFileSync(path.join(vaultRoot, "secret.txt"), "datos");

  // "Fuera de la boveda": simula ~/.ssh/id_rsa.
  outsideDir = path.join(tmpRoot, "outside");
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, "id_rsa"), "PRIVATE KEY MATERIAL");

  // Enlace que escapa de la boveda. En Windows usamos un JUNCTION NTFS
  // (no requiere privilegios) en vez de symlink; realpath lo resuelve igual,
  // por lo que ejercita la misma proteccion de contencion.
  try {
    const linkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(outsideDir, path.join(vaultRoot, "escape_link"), linkType);
    symlinkAvailable = true;
  } catch {
    symlinkAvailable = false;
  }

  // El guardian se ancla a la raiz canonica de la boveda.
  guard = new PathGuard(fs.realpathSync(vaultRoot));
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// --- Helper ------------------------------------------------------------------

function assertDenied(
  input: string,
  code: PathErrorCode,
  options: ResolveOptions = {},
): void {
  assert.throws(
    () => guard.resolveSafePath(input, options),
    (err: unknown) =>
      err instanceof PathSecurityError &&
      err.code === code,
    `Se esperaba DENEGAR "${input}" con codigo ${code}`,
  );
}

// =============================================================================
// LECTURAS LEGITIMAS (deben FUNCIONAR)
// =============================================================================

test("LEGIT: lee una nota de la raiz", () => {
  const safe = guard.resolveSafePath("Nota.md");
  const content = fs.readFileSync(safe, "utf8");
  assert.match(content, /idea brillante/);
});

test("LEGIT: lee una nota anidada", () => {
  const safe = guard.resolveSafePath("Proyectos/idea.md");
  assert.ok(fs.existsSync(safe));
});

test("LEGIT: enumeracion solo ve .md, excluye .obsidian y no-markdown", () => {
  const notes = collectMarkdown(guard, guard.root, "");
  assert.deepEqual(notes, ["Nota.md", "Proyectos/idea.md"]);
});

test("LEGIT: la busqueda encuentra texto en las notas", () => {
  const notes = collectMarkdown(guard, guard.root, "");
  const found = notes.some((rel) =>
    fs
      .readFileSync(guard.resolveSafePath(rel), "utf8")
      .toLowerCase()
      .includes("brillante"),
  );
  assert.ok(found, "Deberia encontrar 'brillante' en alguna nota");
});

// =============================================================================
// RED TEAM: ATAQUES (deben FALLAR / ser denegados)
// =============================================================================

test("ATTACK: path traversal POSIX  ../../../.ssh/id_rsa", () => {
  assertDenied("../../../.ssh/id_rsa", "PATH_ESCAPE");
});

test("ATTACK: path traversal backslash  ..\\..\\..\\.ssh\\id_rsa", () => {
  assertDenied("..\\..\\..\\.ssh\\id_rsa", "PATH_ESCAPE");
});

test("ATTACK: ruta absoluta POSIX  /etc/passwd", () => {
  assertDenied("/etc/passwd", "ABSOLUTE_INPUT");
});

test("ATTACK: ruta absoluta Windows  C:\\Windows\\System32\\config\\SAM", () => {
  // Contiene ':' -> se rechaza en el chequeo de caracter (mas temprano) que el de ruta absoluta.
  assertDenied("C:\\Windows\\System32\\config\\SAM", "INVALID_CHARACTER");
});

test("ATTACK: ruta UNC  \\\\atacante\\share\\x.md", () => {
  assertDenied("\\\\atacante\\share\\x.md", "ABSOLUTE_INPUT");
});

test("ATTACK: unidad relativa Windows  C:secreto.md", () => {
  assertDenied("C:secreto.md", "INVALID_CHARACTER");
});

test("ATTACK: flujo de datos alternativo NTFS  Nota.md:oculto", () => {
  assertDenied("Nota.md:oculto", "INVALID_CHARACTER");
});

test("ATTACK: acceso a config oculta  .obsidian/workspace", () => {
  assertDenied(".obsidian/workspace", "HIDDEN_SEGMENT");
});

test("ATTACK: carpeta oculta  .ssh/id_rsa (dentro de la boveda)", () => {
  assertDenied(".ssh/id_rsa", "HIDDEN_SEGMENT");
});

test("ATTACK: byte nulo  Nota\\0.md", () => {
  assertDenied("Nota\0.md", "NULL_BYTE");
});

test("ATTACK: entrada vacia", () => {
  assertDenied("   ", "EMPTY_INPUT");
});

test("ATTACK: archivo no-markdown  secret.txt", () => {
  assertDenied("secret.txt", "INVALID_EXTENSION");
});

test("ATTACK: symlink que escapa de la boveda", (t) => {
  if (!symlinkAvailable) {
    t.skip(
      "Symlinks no disponibles (Windows sin modo desarrollador / sin privilegios)",
    );
    return;
  }
  // escape_link -> outside/. Lexicamente parece dentro, pero realpath escapa.
  assertDenied("escape_link/id_rsa", "SYMLINK_ESCAPE");
});

test("ATTACK: la enumeracion NO sigue el symlink hacia fuera", (t) => {
  if (!symlinkAvailable) {
    t.skip("Symlinks no disponibles");
    return;
  }
  const notes = collectMarkdown(guard, guard.root, "");
  // Ninguna nota puede provenir de 'escape_link' ni del directorio externo.
  assert.ok(
    notes.every((n) => !n.startsWith("escape_link")),
    "La enumeracion no debe cruzar el symlink de escape",
  );
});
