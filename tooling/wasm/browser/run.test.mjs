// Controls for the browser runner: it runs in Chromium, it reports what a
// script did rather than a pass, it ends a run as node would, and it leaves
// no browser and no profile behind, however the run ends.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));

function scratch(source) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nts-browser-control-'));
  const script = path.join(dir, 'script.mjs');
  writeFileSync(script, source);
  return { dir, script };
}
function run(source, env = {}) {
  const { dir, script } = scratch(source);
  try {
    return spawnSync(process.execPath, [runner, script], {
      encoding: 'utf8', timeout: 60000,
      env: { ...process.env, NTS_BROWSER_REPORT_PROFILE: '1', ...env },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
/** Whether a run's reported profile, or any process naming it, is left. */
function leftovers(stderr) {
  const profile = /^profile (.+)$/m.exec(stderr)?.[1];
  assert.ok(profile, `no profile reported:\n${stderr}`);
  const processes = readdirSync('/proc').filter(pid => /^\d+$/.test(pid)).filter(pid => {
    try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(profile); } catch { return false; }
  });
  return { profile: existsSync(profile), processes };
}
function clean(stderr) {
  assert.deepEqual(leftovers(stderr), { profile: false, processes: [] });
}

test('the page is headless Chromium with WasmGC exceptions', () => {
  const result = run("console.log(/HeadlessChrome/.test(navigator.userAgent), typeof WebAssembly.JSTag, typeof window);");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'true object object');
  clean(result.stderr);
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
test('the run ends when nothing is left to run, as a node run does', () => {
  const pending = run("setTimeout(() => console.log('after'), 50); console.log('before');");
  assert.equal(pending.status, 0, pending.stderr);
  assert.equal(pending.stdout.trim(), 'before\nafter');
  // node exits 1 for both, after the module itself has finished.
  assert.equal(run("Promise.reject(new Error('late rejection'));").status, 1);
  const timer = run("setTimeout(() => { throw new Error('timer threw'); }, 10);");
  assert.equal(timer.status, 1);
  assert.match(timer.stderr, /timer threw/);
});
test('a file outside the served roots is refused, not missing', () => {
  const outside = run("import { readFile } from 'node:fs/promises'; await readFile('/etc/hostname', 'utf8');");
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /EACCES/);
  // A link inside a root does not reach outside every root.
  const { dir, script } = scratch('');
  try {
    symlinkSync('/etc/hostname', path.join(dir, 'link'));
    writeFileSync(script, `import { readFile } from 'node:fs/promises'; await readFile(${JSON.stringify(path.join(dir, 'link'))}, 'utf8');`);
    const linked = spawnSync(process.execPath, [runner, script], { encoding: 'utf8', timeout: 60000 });
    assert.equal(linked.status, 1);
    assert.match(linked.stderr, /EACCES/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('a run that does not finish times out and leaves nothing behind', () => {
  const result = run('setInterval(() => {}, 1000);', { NTS_BROWSER_TIMEOUT_MS: '2000' });
  assert.equal(result.status, 124);
  clean(result.stderr);
});
test('SIGTERM stops the browser and removes its profile', async () => {
  const { dir, script } = scratch('setInterval(() => {}, 1000);');
  try {
    const child = spawn(process.execPath, [runner, script], {
      env: { ...process.env, NTS_BROWSER_REPORT_PROFILE: '1' },
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    await new Promise(resolve => { setTimeout(resolve, 3000); });
    child.kill('SIGTERM');
    const code = await new Promise(resolve => child.once('exit', resolve));
    assert.equal(code, 143);
    clean(stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
