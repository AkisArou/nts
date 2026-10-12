// Controls for the browser runner: it runs in Chromium, and it reports what a
// script did rather than a pass.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));

function run(source, ...args) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nts-browser-control-'));
  try {
    const script = path.join(dir, 'script.mjs');
    writeFileSync(script, source);
    return spawnSync(process.execPath, [runner, script, ...args], { encoding: 'utf8', timeout: 60000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the page is headless Chromium with WasmGC exceptions', () => {
  const result = run("console.log(/HeadlessChrome/.test(navigator.userAgent), typeof WebAssembly.JSTag, typeof window);");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'true object object');
});
test('an exit code comes back', () => {
  assert.equal(run('process.exitCode = 7;').status, 7);
  assert.equal(run("try { process.exit(3); } catch {} console.log('unreached');").status, 3);
});
test('a failed assertion fails the run', () => {
  const result = run("import assert from 'node:assert/strict'; assert.equal(1, 2, 'deliberate');");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deliberate/);
});
test('a file outside the served roots is refused', () => {
  const result = run("import { readFile } from 'node:fs/promises'; await readFile('/etc/hostname', 'utf8');");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
});
