#!/usr/bin/env node
/**
 * Builds and runs an app on the compiled renderer.
 *
 *   node tooling/chromium/app.ts build <dir> [--backend c|llvm] [--profile perf|baseline]
 *   node tooling/chromium/app.ts run   <dir> [--backend c|llvm] [--profile perf|baseline] [-- <shell flags>]
 *   node tooling/chromium/app.ts check <dir> [--profile perf|baseline] [--expect <selector>]
 *
 * An app is a directory: `index.html`, which opts in with
 * `<meta name="nts-app">`, and `main.ts`, whose `main(document: Document)` runs
 * once the page has loaded, with an optional `unload()` for when it ends;
 * other TypeScript beside them, and the page's assets. Nothing else: the
 * build's configuration is written here, under target/chromium/apps/<name>.
 *
 * `build` compiles the program, archives it with the app host
 * (runtime/chromium/host) by Chromium's toolchain, stages it beside the test
 * probe, and builds `nts_app_shell`, the release shell (host/shell_main.cc:
 * a content embedder of its own, nothing of the test-only content_shell; its
 * resources are nts_app.pak). `run` opens the app's page in it, served from
 * the app's own origin, nts-app://app/ (the directory is --nts-app-dir).
 * `check` runs the built app headless through its lifecycle: it is served as
 * that origin, a secure context, with its stylesheets; it starts, renders what
 * `--expect` names, ends cleanly on reload and starts again, and the shell
 * exits when its window closes, with no renderer check failing on the way.
 *
 * `unload()` runs whenever the document ends in a renderer that goes on --
 * reload, navigation. Closing the window may end the renderer process without
 * unloading, as Chromium does for a page with no unload handlers ("fast
 * shutdown"), which is what page script's `unload` gets too.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { archiveProgram, chromiumToolchain } from "./archive.ts";
import { openPage } from "./browser.ts";
import { buildProfile } from "./profiles.ts";

const root = resolve(import.meta.dirname, "../..");
const lane = resolve(root, "runtime/chromium");
const usage = "Usage: node tooling/chromium/app.ts build|run|check <dir> [--backend c|llvm] [--profile perf|baseline] [--expect <selector>] [-- <shell flags>]";

const [command, directory, ...rest] = process.argv.slice(2);
if ((command !== "build" && command !== "run" && command !== "check") || directory === undefined) throw new Error(usage);
const separator = rest.indexOf("--");
const options = separator < 0 ? rest : rest.slice(0, separator);
const shellFlags = separator < 0 ? [] : rest.slice(separator + 1);
const option = (name: string, fallback: string): string => {
  const at = options.indexOf(name);
  return at < 0 ? fallback : options[at + 1] ?? fallback;
};
const backend = option("--backend", "c");
if (backend !== "c" && backend !== "llvm") throw new Error(usage);
const profile = buildProfile(["--profile", option("--profile", "perf")]);

const app = resolve(directory);
const page = resolve(app, "index.html");
const entry = resolve(app, "main.ts");
if (!existsSync(page) || !existsSync(entry)) throw new Error(`${app} needs index.html and main.ts`);
if (!/<meta\s+name="nts-app"/.test(readFileSync(page, "utf8"))) {
  throw new Error(`${relative(root, page)} does not opt in: add <meta name="nts-app">`);
}
const name = basename(app);
// The app's origin: the shell serves nts-app://app/<path> from the app's
// directory (host/app_main.cc), so the page is a secure context of its own.
const appUrl = "nts-app://app/index.html";
const appArgs = [`--nts-app-dir=${app}`];
const work = resolve(root, "target/chromium/apps", name);
const source = resolve(root, "third_party/chromium/src");
const shell = resolve(source, profile.directory, "nts_app_shell");

if (command === "build") build();
else if (command === "run") run();
else await check();

function build(): void {
  mkdirSync(work, { recursive: true });
  // The build's configuration, so the app directory needs none: every
  // TypeScript file in it. target.chromium() supplies the rest: the DOM
  // surface (nts:dom, and lib.dom bound to it) and the DOM's native half.
  const sources = typescriptFiles(app);
  writeFileSync(resolve(work, "tsconfig.json"), `${JSON.stringify({
    extends: resolve(root, "tsconfig.fixtures.json"),
    files: sources,
  }, null, 2)}\n`);
  const product = backend === "c" ? "app" : "app-llvm";
  writeFileSync(resolve(work, "nts.config.ts"), `// Written by tooling/chromium/app.ts for ${relative(root, app)}.
import { defineConfig, library, target } from ${JSON.stringify(resolve(root, "tooling/config/src/index.ts"))};
export default defineConfig({
  products: {
    ${JSON.stringify(product)}: library.staticNative({
      targets: [target.chromium({ backend: ${JSON.stringify(backend)} })],
      entry: ${JSON.stringify(relative(work, entry))},
    }),
  },
});
`);
  const nts = resolve(root, process.env.NTS_BIN ?? "target/release/nts");
  const output = resolve(work, "out");
  execFileSync(nts, ["build", resolve(work, "tsconfig.json"), "--out", output, "--rc"], {
    cwd: root, stdio: "inherit", env: { ...process.env, NTS_NO_ACQUIRE: "1" },
  });
  const generated = resolve(output, product, "linux-gnu-x86_64");
  const entryHeader = resolve(work, backend);
  mkdirSync(entryHeader, { recursive: true });
  writeFileSync(resolve(entryHeader, "app_entry.h"), appEntry(readFileSync(resolve(generated, "program.h"), "utf8")));
  const archive = resolve(work, backend, "app.a");
  archiveProgram({ root, toolchain: chromiumToolchain(root), backend, generated, archive,
    sources: [resolve(lane, "host/host.c"), resolve(lane, "host/app.c")], includes: [entryHeader] });
  // Stage beside the test probe (its own program is rebuilt and checked too)
  // and build the shells with it: nts_app_shell, which run and check use, and
  // the test shell nts_app.
  execFileSync(process.execPath, [resolve(root, "tooling/chromium/probe.ts"), backend, "--profile", profile.name, "--app", archive],
    { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [resolve(root, "tooling/chromium/chromium.ts"), "build", "--profile", profile.name],
    { cwd: root, stdio: "inherit" });
  const result = resolve(root, profile.evidence, "build-result.json");
  for (;;) {
    const state = existsSync(result) ? (JSON.parse(readFileSync(result, "utf8")) as { state: string }).state : "running";
    if (state === "passed") break;
    if (state === "failed") throw new Error(`The build failed; see ${relative(root, resolve(root, profile.evidence, "build.log"))}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
  }
  console.log(`Built ${relative(root, shell)} with ${name} (${backend}). Run: node tooling/chromium/app.ts run ${relative(root, app)}`);
}

function run(): void {
  if (!existsSync(shell)) throw new Error(`No ${relative(root, shell)}; run: node tooling/chromium/app.ts build ${relative(root, app)}`);
  const status = spawnSync(shell, [...appArgs, ...shellFlags, appUrl], { stdio: "inherit" }).status;
  process.exit(status ?? 1);
}

async function check(): Promise<void> {
  if (!existsSync(shell)) throw new Error(`No ${relative(root, shell)}; run: node tooling/chromium/app.ts build ${relative(root, app)}`);
  const expected = option("--expect", "");
  mkdirSync(work, { recursive: true });
  const page = await openPage(shell, appUrl, { temporary: work, args: ["--enable-logging=stderr", ...appArgs, ...shellFlags] });
  const starts = (): number => page.log().match(/NTS_APP start/g)?.length ?? 0;
  const stops = (): number => page.log().match(/NTS_APP stop/g)?.length ?? 0;
  try {
    await page.until(() => starts() === 1, "the app to start");
    // Served from its own origin, a secure context, with its stylesheets
    // (subresources of the app's URL) loaded.
    const served = await page.evaluate<string>(`location.origin + "|" + isSecureContext + "|" +
      [...document.styleSheets].every(sheet => sheet.cssRules.length > 0)`);
    if (served !== "nts-app://app|true|true") throw new Error(`The app is not served as nts-app://app with its styles: ${served}`);
    // Nothing outside the app's directory is served, through any spelling
    // of a parent; the app's own file, fetched the same way, is.
    const escaped = await page.evaluate<string>(`Promise.all(["styles.css", "%2e%2e/%2e%2e/%2e%2e/etc/hostname", "..%2f..%2f..%2fetc%2fhostname"]
      .map(path => fetch("nts-app://app/" + path).then(response => "read " + response.status, () => "refused"))).then(all => all.join("|"))`);
    if (escaped !== "read 200|refused|refused") throw new Error(`A path outside the app was served: ${escaped}`);
    // The shell's permission policy (host/app_permissions.h): the clipboard
    // granted to the app, with no prompt, and the rest denied; a write read
    // back. The Clipboard API also wants a focused document, which a window
    // nobody is typing into is not: focus is emulated.
    await page.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
    const permitted = await page.evaluate<string>(`Promise.all(["clipboard-read", "clipboard-write", "geolocation", "notifications"]
      .map(name => navigator.permissions.query({ name }).then(status => status.state, error => error.name))).then(all => all.join("|"))`);
    if (permitted !== "granted|granted|denied|denied") throw new Error(`The app's permissions are not the shell's policy: ${permitted}`);
    const copied = await page.evaluate<string>(`navigator.clipboard.writeText("nts-app clipboard").then(() => navigator.clipboard.readText(), error => error.name + ": " + error.message)`);
    if (copied !== "nts-app clipboard") throw new Error(`The clipboard did not round-trip: ${copied}`);
    if (expected !== "") await page.until(() => page.evaluate<boolean>(`document.querySelector(${JSON.stringify(expected)}) !== null`), `${expected} to render`);
    await page.cdp("Page.reload");
    await page.until(() => stops() === 1 && starts() === 2, "the app to end and start again on reload");
    if (expected !== "") await page.until(() => page.evaluate<boolean>(`document.querySelector(${JSON.stringify(expected)}) !== null`), `${expected} to render again`);
  } finally {
    await page.close();
  }
  writeFileSync(resolve(work, "check.log"), page.log());
  console.log(`PASS: ${name} started, rendered${expected === "" ? "" : ` ${expected}`}, held the clipboard and no other permission, ended cleanly and restarted on reload, and closed`);
}

/** Every TypeScript file of the app, but not its dependencies or output. */
function typescriptFiles(directory: string): string[] {
  const found: string[] = [];
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name.startsWith(".")) continue;
    const path = resolve(directory, item.name);
    if (item.isDirectory()) found.push(...typescriptFiles(path));
    else if (item.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

/**
 * The host's view of the program (host/app.c): the C symbol of `main` -- the
 * compiler escapes a C keyword or reserved name, and says which in
 * program.h -- whether it takes over the caller's reference to the document,
 * and `unload`'s symbol, if the program exports one.
 */
function appEntry(header: string): string {
  const exported = (name: string): RegExpExecArray | null =>
    new RegExp(`/\\* Export: ${name}\\. C symbol: (\\w+)\\.([^*]*)\\*/`).exec(header);
  const main = exported("main");
  if (main === null) throw new Error("main.ts must export `function main(document: Document): void`");
  // Module-level state is process-wide in a compiled program, and an app's
  // program lives per document: what a reload left in it would outlive its
  // environment. Until the compiler scopes module state to an environment,
  // an app keeps its state in what `main` creates.
  if (/\bmodule__init\s*\(/.test(header)) {
    throw new Error("The app has module-level state (program.h declares module__init). " +
      "Keep the app's state in what main() creates -- the closures its listeners and timers hold -- " +
      "until module state per document is supported.");
  }
  const unload = exported("unload");
  return [
    "/* Written by tooling/chromium/app.ts from the app's program.h. */",
    `#define NTS_APP_MAIN ${main[1]}`,
    `#define NTS_APP_MAIN_TAKES_DOCUMENT ${/Takes over the caller's reference/.test(main[2]) ? 1 : 0}`,
    ...(unload === null ? [] : [`#define NTS_APP_UNLOAD ${unload[1]}`]),
    "",
  ].join("\n");
}
