import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PathGuard,
  PathSecurityError,
  type PathErrorCode,
} from "../src/security/pathGuard.js";
import { atomicWrite, moveToTrash } from "../src/tools/writeTools.js";

let tmpRoot: string;
let vaultRoot: string;
let outsideDir: string;
let guard: PathGuard;
let symlinkAvailable = false;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-mcp-write-"));
  vaultRoot = path.join(tmpRoot, "vault");
  fs.mkdirSync(vaultRoot);
  fs.writeFileSync(path.join(vaultRoot, "Existente.md"), "contenido original\n");

  outsideDir = path.join(tmpRoot, "outside");
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, "victima.md"), "fuera");

  try {
    const linkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(outsideDir, path.join(vaultRoot, "escape_link"), linkType);
    symlinkAvailable = true;
  } catch {
    symlinkAvailable = false;
  }

  guard = new PathGuard(fs.realpathSync(vaultRoot));
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function assertDenied(input: string, code: PathErrorCode): void {
  assert.throws(
    () => guard.resolveSafeWritePath(input),
    (err: unknown) => err instanceof PathSecurityError && err.code === code,
    `Se esperaba DENEGAR escritura "${input}" con codigo ${code}`,
  );
}

// ---- LEGIT: escrituras permitidas ------------------------------------------

test("WRITE LEGIT: destino nuevo en la raiz (parent existe)", () => {
  const safe = guard.resolveSafeWritePath("Nueva.md");
  assert.ok(safe.startsWith(guard.root));
  assert.equal(fs.existsSync(safe), false);
});

test("WRITE LEGIT: destino nuevo en subcarpeta inexistente (creacion anidada)", () => {
  const safe = guard.resolveSafeWritePath("SubNueva/Anidada.md");
  assert.ok(safe.startsWith(guard.root + path.sep));
});

test("WRITE LEGIT: destino existente devuelve su ruta real", () => {
  const safe = guard.resolveSafeWritePath("Existente.md");
  assert.equal(fs.existsSync(safe), true);
});

test("WRITE LEGIT: atomicWrite crea y luego sobrescribe", () => {
  const safe = guard.resolveSafeWritePath("Atomica.md");
  atomicWrite(safe, "v1");
  assert.equal(fs.readFileSync(safe, "utf8"), "v1");
  atomicWrite(safe, "v2");
  assert.equal(fs.readFileSync(safe, "utf8"), "v2");
});

test("WRITE LEGIT: moveToTrash mueve a .trash y deja el origen vacio", () => {
  const src = guard.resolveSafeWritePath("ParaBorrar.md");
  atomicWrite(src, "adios");
  const rel = moveToTrash(guard, src);
  assert.equal(fs.existsSync(src), false, "el origen ya no existe");
  assert.ok(rel.startsWith(".trash/"), `destino en papelera: ${rel}`);
  assert.ok(fs.existsSync(path.join(guard.root, rel)), "esta en la papelera");
});

// ---- RED TEAM: escrituras denegadas ----------------------------------------

test("WRITE ATTACK: traversal POSIX  ../../evil.md", () => {
  assertDenied("../../evil.md", "PATH_ESCAPE");
});

test("WRITE ATTACK: traversal backslash  ..\\..\\evil.md", () => {
  assertDenied("..\\..\\evil.md", "PATH_ESCAPE");
});

test("WRITE ATTACK: ruta absoluta  /tmp/evil.md", () => {
  assertDenied("/tmp/evil.md", "ABSOLUTE_INPUT");
});

test("WRITE ATTACK: escribir en oculto  .obsidian/evil.md", () => {
  assertDenied(".obsidian/evil.md", "HIDDEN_SEGMENT");
});

test("WRITE ATTACK: extension no permitida  evil.txt", () => {
  assertDenied("evil.txt", "INVALID_EXTENSION");
});

test("WRITE ATTACK: dos-puntos / unidad  C:evil.md", () => {
  assertDenied("C:evil.md", "INVALID_CHARACTER");
});

test("WRITE ATTACK: escribir a traves de symlink que escapa", (t) => {
  if (!symlinkAvailable) {
    t.skip("Symlinks no disponibles");
    return;
  }
  assertDenied("escape_link/inyectada.md", "SYMLINK_ESCAPE");
});
