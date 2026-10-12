// Run a Wasm check script in headless Chromium, as node would run it.
//
//   node tooling/wasm/browser/run.mjs <script.mjs> [args...]
//
// - The script's `node:` imports resolve to the shims in ./node.
// - Filesystem paths are served over HTTP under /fs: a `.ts` file with its
//   types stripped, and a missing `.js` resolving to its `.ts` sibling, as
//   the census's resolve hook does. Reads and writes are confined to the
//   repository and the directories of the path arguments.
// - The script's stdout, stderr and exit code become this process's.
//
// An artifact emitted with `--host browser` loads its module the browser way,
// through compileStreaming(fetch(...)). NTS_CHROMIUM names the browser
// (default `chromium`); NTS_BROWSER_TIMEOUT_MS bounds one run (default
// 120000), and a run that exceeds it exits 124. A caller with its own
// deadline sets this below it: a runner killed outright cannot stop the
// browser it started. SIGTERM, SIGINT and SIGHUP stop the browser and remove
// its profile first.
//
// The run's result is decided before cleanup, and cleanup never changes it:
// the browser's whole process group is killed and awaited, then its profile
// is removed with retries, and a failure to remove it is a note on stderr.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [script, ...rawArgs] = process.argv.slice(2);
if (!script) throw new TypeError('usage: run.mjs <script.mjs> [args...]');
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../../..');
const pathLike = arg => arg.startsWith('/') || arg.startsWith('.') || existsSync(arg);
const args = rawArgs.map(arg => (pathLike(arg) ? path.resolve(arg) : arg));
const real = file => (existsSync(file) ? realpathSync(file) : file);
const roots = [repository, path.dirname(path.resolve(script)), ...args.filter(pathLike).map(arg =>
  existsSync(arg) && statSync(arg).isDirectory() ? arg : path.dirname(arg))].map(real);
// Confinement is checked on the real path, so a link inside a root cannot
// serve a file outside every root.
const inside = file => {
  const resolved = existsSync(file) ? realpathSync(file) : path.join(real(path.dirname(file)), path.basename(file));
  return roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
};
const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.ts': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json' };
const shims = { 'node:assert/strict': 'assert', 'node:assert': 'assert', 'node:url': 'url',
  'node:path': 'path', 'node:fs': 'fs', 'node:fs/promises': 'fs-promises',
  'node:module': 'module', 'node:vm': 'vm' };
const encode = file => file.split('/').map(encodeURIComponent).join('/');

function page() {
  const imports = Object.fromEntries(Object.entries(shims).map(([name, file]) => [name, `/node/${file}.mjs`]));
  const argv = ['node', path.resolve(script), ...args];
  return `<!doctype html><meta charset="utf-8">
<script type="importmap">${JSON.stringify({ imports })}</script>
<script type="module">
const out = [], err = [];
const text = values => values.map(value => typeof value === 'string' ? value : String(value)).join(' ');
console.log = (...values) => out.push(text(values));
console.error = (...values) => err.push(text(values));
// node exits when nothing is left to run, so the page tracks its timers and
// reports only when none is pending; an interval keeps it alive until it is
// cleared, as it keeps node alive.
const { setTimeout: later, clearTimeout: cancel, setInterval: every, clearInterval: stop } = globalThis;
const live = new Set();
globalThis.setTimeout = (callback, delay, ...rest) => {
  const id = later(() => { live.delete(id); if (typeof callback === 'function') callback(...rest); }, delay);
  live.add(id);
  return id;
};
globalThis.clearTimeout = id => { live.delete(id); cancel(id); };
globalThis.setInterval = (...rest) => { const id = every(...rest); live.add(id); return id; };
globalThis.clearInterval = id => { live.delete(id); stop(id); };
let reported = false;
function report(code) {
  if (reported) return;
  reported = true;
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/done', false);
  xhr.send(JSON.stringify({ stdout: out.join('\\n'), stderr: err.join('\\n'), code }));
}
class Exit extends Error {}
globalThis.process = {
  argv: ${JSON.stringify(argv)}, env: {}, platform: 'browser', execPath: 'chromium',
  exitCode: undefined, exited: false, cwd: () => ${JSON.stringify(process.cwd())},
  // node stops at exit; here the call reports at once and unwinds, and the
  // fs shim drops any write made while unwinding.
  exit(code = this.exitCode ?? 0) { this.exited = true; report(code); throw new Exit(\`process.exit(\${code})\`); },
};
// An uncaught throw or an unhandled rejection ends a node run with 1.
function fail(error) {
  if (error instanceof Exit) return;
  err.push(String(error?.stack ?? error));
  report(1);
}
addEventListener('unhandledrejection', event => fail(event.reason));
addEventListener('error', event => fail(event.error ?? event.message));
const turn = () => new Promise(resolve => later(resolve, 0));
try {
  await import(${JSON.stringify(`/fs${encode(path.resolve(script))}`)});
  do { await turn(); } while (live.size);
  // One more turn, so a rejection nobody handled is reported before success.
  await turn();
  report(process.exitCode ?? 0);
} catch (error) {
  fail(error);
}
</script>`;
}

async function serve(request, response, finish) {
  const url = new URL(request.url, 'http://localhost');
  const send = (status, body = '', type = 'text/plain') => {
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  if (url.pathname === '/') return send(200, page(), 'text/html');
  if (url.pathname.startsWith('/node/')) {
    const file = path.join(here, 'node', path.basename(url.pathname));
    return send(200, await readFile(file), 'text/javascript');
  }
  const body = () => new Promise(resolve => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
  if (url.pathname === '/done' && request.method === 'POST') {
    finish(JSON.parse((await body()).toString('utf8')));
    return send(200);
  }
  for (const [prefix, writing] of [['/fs/', false], ['/write/', true]]) {
    if (!url.pathname.startsWith(prefix)) continue;
    const file = path.resolve(decodeURIComponent(url.pathname.slice(prefix.length - 1)));
    if (!inside(file)) return send(403, `refused: outside the served roots: ${file}`);
    if (writing) {
      if (request.method !== 'POST') return send(405);
      await writeFile(file, await body());
      return send(200);
    }
    let served = file;
    if (!existsSync(served) && served.endsWith('.js') && existsSync(`${served.slice(0, -3)}.ts`)) {
      served = `${served.slice(0, -3)}.ts`;
    }
    if (!existsSync(served) || statSync(served).isDirectory()) return send(404);
    const extension = path.extname(served);
    const content = await readFile(served);
    if (extension === '.ts') {
      return send(200, stripTypeScriptTypes(content.toString('utf8'), { mode: 'transform', sourceUrl: served }), types['.ts']);
    }
    return send(200, content, types[extension] ?? 'application/octet-stream');
  }
  return send(404);
}

const timeout = Number(process.env.NTS_BROWSER_TIMEOUT_MS ?? 120000);
const delay = ms => new Promise(resolve => { setTimeout(resolve, ms); });
let finish;
const finished = new Promise(resolve => { finish = resolve; });
const server = createServer((request, response) => {
  serve(request, response, finish).catch(error => {
    response.writeHead(500, { 'content-type': 'text/plain' });
    response.end(String(error?.stack ?? error));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(path.join(tmpdir(), 'nts-chromium-'));
// Its own process group, so stopping it stops every process it started.
const browser = spawn(process.env.NTS_CHROMIUM ?? 'chromium', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-sync', '--mute-audio', `--user-data-dir=${profile}`,
  `http://127.0.0.1:${server.address().port}/`,
], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
let browserLog = '';
browser.stderr.on('data', chunk => { browserLog += chunk; });
const browserExited = new Promise(resolve => browser.once('exit', resolve));
const exited = browserExited.then(code => ({ browserExit: code }));

/** Kill the browser's process group and wait for every member to be gone. */
async function stopBrowser() {
  try { process.kill(-browser.pid, 'SIGKILL'); } catch { /* already gone */ }
  await Promise.race([browserExited, delay(5000)]);
  for (const deadline = Date.now() + 5000; Date.now() < deadline; await delay(50)) {
    try { process.kill(-browser.pid, 0); } catch { return; }
  }
}
let cleaning;
/** Stop the browser and the server, then remove the profile; never throws. */
function cleanup() {
  cleaning ??= (async () => {
    await stopBrowser();
    server.closeAllConnections();
    server.close();
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      process.stderr.write(`note: could not remove ${profile}: ${error.message}\n`);
    }
    if (process.env.NTS_BROWSER_REPORT_PROFILE) process.stderr.write(`profile ${profile}\n`);
  })();
  return cleaning;
}
for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) {
  process.once(signal, () => { cleanup().finally(() => process.exit(code)); });
}
let timer;
const result = await Promise.race([
  finished,
  exited,
  new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), timeout); }),
]);
clearTimeout(timer);
await cleanup();
if (result.timedOut) {
  process.stderr.write(`browser run timed out after ${timeout} ms\n`);
  process.exit(124);
}
if ('browserExit' in result) {
  process.stderr.write(`chromium exited (${result.browserExit}) before the script finished\n${browserLog}`);
  process.exit(125);
}
if (result.stdout) process.stdout.write(`${result.stdout}\n`);
if (result.stderr) process.stderr.write(`${result.stderr}\n`);
process.exit(result.code);
