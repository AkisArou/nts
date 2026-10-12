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
// 120000), and a run that exceeds it exits 124.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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
const roots = [repository, path.dirname(path.resolve(script)), ...args.filter(pathLike).map(arg =>
  existsSync(arg) && statSync(arg).isDirectory() ? arg : path.dirname(arg))];
const inside = file => roots.some(root => file === root || file.startsWith(root + path.sep));
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
addEventListener('unhandledrejection', event => {
  if (event.reason instanceof Exit) return;
  err.push(String(event.reason?.stack ?? event.reason)); report(1);
});
try {
  await import(${JSON.stringify(`/fs${encode(path.resolve(script))}`)});
  report(process.exitCode ?? 0);
} catch (error) {
  if (!(error instanceof Exit)) { err.push(String(error?.stack ?? error)); report(1); }
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
    if (!inside(file)) return send(403, `outside the served roots: ${file}`);
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
const browser = spawn(process.env.NTS_CHROMIUM ?? 'chromium', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-sync', '--mute-audio', `--user-data-dir=${profile}`,
  `http://127.0.0.1:${server.address().port}/`,
], { stdio: ['ignore', 'ignore', 'pipe'] });
let browserLog = '';
browser.stderr.on('data', chunk => { browserLog += chunk; });
const exited = new Promise(resolve => browser.on('exit', code => resolve({ browserExit: code })));
let timer;
const result = await Promise.race([
  finished,
  exited,
  new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), timeout); }),
]);
clearTimeout(timer);
browser.kill('SIGKILL');
server.closeAllConnections();
server.close();
await rm(profile, { recursive: true, force: true });
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
