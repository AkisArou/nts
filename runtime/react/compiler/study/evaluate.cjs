// The behaviour oracle: upstream's compiler fixtures, run on *our* React.
//
// Upstream's sprout renders each fixture's FIXTURE_ENTRYPOINT through its
// `sequentialRenders` and compares the fixture as written with the compiled
// one. This does the same on our reconciler and the probe's test host (our
// runtime has no DOM), for three variants of each fixture:
//
//   written   the source, JSX by esbuild
//   upstream  upstream's Babel plugin output, outlining off
//   ours      `nts-react compile ... --lower-jsx --typed-cache`, outlining off
//
// A render is the host tree with every prop printed, plus what the render
// logged; an exception is recorded as the render's result, as sprout's error
// boundary does. All three must agree. `upstream` against `written` is
// sprout's own claim, checked on our runtime; `ours` against both is ours.
//
// usage: node evaluate.cjs <set-dir> <mode-list> [fixture-name-filter]
//   <mode-list> is lines of "<infer|all> <file>", as for the other oracles.
//   Run from the study workspace (NODE_PATH=$PWD/node_modules), with
//   NTS_REACT and NTS_TSGO as oracles.sh sets them.
//   EVALUATE_SHOW=1 prints what agreeing fixtures rendered, too.
//   EVALUATE_CONTROL=1 flips every cache comparison in `ours` (`$[k] !== x`,
//   or `$.sK !== x` in a typed cache, to `===`): a variant that memoizes
//   wrongly, which must disagree wherever a fixture's renders depend on its
//   inputs.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");
const babel = require("@babel/core");

const lane = path.resolve(__dirname, "../..");
const repo = path.resolve(lane, "../..");
const esbuild = require(require.resolve("esbuild", { paths: [lane] }));
const PLUGIN = process.env.HOME + "/.cache/nts-react/upstream/compiler/packages/babel-plugin-react-compiler-rust/dist";
const plugin = require(PLUGIN).default;
const ntsReact = process.env.NTS_REACT || process.env.HOME + "/.cache/nts-react/target/debug/nts-react";
process.env.NTS_TSGO = process.env.NTS_TSGO || path.join(repo, "target/tsgo");

const [setDir, modeList, only] = process.argv.slice(2);
const study = process.cwd();
const sharedRuntime = path.join(study, "stubs/shared-runtime.ts");
// The native programs' configuration: every lane package mapped to its source,
// and the probe's test host as the renderer's host config.
const tsconfig = path.join(lane, "native/compiled/tsconfig.json");
const hostDir = path.join(lane, "native/compiled/src");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "evaluate-"));
const control = process.env.EVALUATE_CONTROL === "1";

// The harness each variant is bundled into. `FIXTURE` resolves to the
// variant's text at the fixture's own path, so its relative imports resolve.
const HARNESS = `
import * as fixture from "fixture:module";
import { Component, createElement } from "react";
import { createContainer, updateContainer } from "react-reconciler/ReactFiberReconciler.ts";
import { ConcurrentRoot } from "react-reconciler/ReactRootTags.ts";
import { TestContainer, TestInstance, TestText } from "./ReactFiberConfig.ts";
import { drainHost } from "./SchedulerHost.ts";
import { toJSON } from "shared-runtime";
import { inspect } from "node:util";

const logs = [];
const record = (...args) => logs.push(args.map((a) => (a instanceof Error ? a.toString() : inspect(a))).join(" "));
console.log = console.info = console.warn = console.error = record;

function show(value) {
  if (typeof value === "function") return "[fn]";
  if (value !== null && typeof value === "object") {
    try { return JSON.stringify(value); } catch { return "[object]"; }
  }
  return String(value);
}
function serialize(node) {
  if (node.hidden) return "";
  if (node instanceof TestText) return node.text;
  const attrs = Object.keys(node.props).filter((k) => k !== "children").sort().map((k) => " " + k + "=" + show(node.props[k])).join("");
  return "<" + node.type + attrs + ">" + node.children.map(serialize).join("") + "</" + node.type + ">";
}

const NO_ERROR = Symbol();
function Invoke(props) {
  const result = props.fn(...props.params);
  if (typeof result === "object" && result !== null && "$$typeof" in result) return result;
  return toJSON(result);
}
// Upstream's WrapperTestComponentWithErrorBoundary: an exception is the
// render's result, and a prop set that threw is not rendered again.
class Boundary extends Component {
  constructor(props) { super(props); this.lastProps = null; this.seen = new Map(); this.state = { error: NO_ERROR }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate() { if (this.state.error !== NO_ERROR) this.setState({ error: NO_ERROR }); }
  render() {
    if (this.state.error !== NO_ERROR && this.props === this.lastProps) {
      const message = "[[ (exception in render) " + String(this.state.error) + " ]]";
      this.seen.set(this.lastProps, message);
      return message;
    }
    this.lastProps = this.props;
    const seen = this.seen.get(this.props);
    if (seen != null) return seen;
    return createElement(Invoke, this.props);
  }
}

const entry = fixture.FIXTURE_ENTRYPOINT;
const container = new TestContainer();
const root = createContainer(container, ConcurrentRoot, null, false, false, "", () => {}, () => {}, () => {}, () => {}, null);
const renders = [];
const sequence = entry.sequentialRenders ?? [entry.params[0]];
const asComponent = entry.sequentialRenders != null || typeof entry.fn === "object";
for (const props of sequence) {
  const params = asComponent ? [props] : entry.params;
  try {
    updateContainer(createElement(Boundary, { fn: entry.fn, params }), root, null, null);
    drainHost();
    renders.push(container.children.map(serialize).join(""));
  } catch (error) {
    renders.push("[[ uncaught " + String(error) + " ]]");
  }
  if (!asComponent) break;
}
process.stdout.write(JSON.stringify({ renders, logs }));
`;

function bundle(fixturePath, text, out) {
  const outside = (importer) => !importer.startsWith(path.join(lane, "packages") + path.sep);
  const substitute = {
    name: "evaluate",
    setup(on) {
      on.onResolve({ filter: /^fixture:module$/ }, () => ({ path: fixturePath }));
      on.onLoad({ filter: /.*/ }, (args) => (args.path === fixturePath ? { contents: text, loader: fixturePath.endsWith(".ts") ? "ts" : "tsx", resolveDir: path.dirname(fixturePath) } : undefined));
      on.onResolve({ filter: /^shared-runtime$/ }, () => ({ path: sharedRuntime }));
      // No fbt here: fixtures that use it need babel-plugin-fbt, and are
      // reported as not evaluable. shared-runtime only imports its init.
      on.onResolve({ filter: /^fbt$/ }, () => ({ path: "fbt", namespace: "shim" }));
      // Our `react` has no default export; fixtures and upstream's helpers
      // write `import React from "react"`.
      on.onResolve({ filter: /^react$/ }, (args) => (outside(args.importer) && args.importer !== "react" ? { path: "react", namespace: "shim" } : undefined));
      on.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({
        resolveDir: hostDir,
        loader: "ts",
        contents: args.path === "fbt"
          ? "export const IntlVariations = { GENDER_UNKNOWN: 0 }; export const IntlViewerContext = {}; export function init(_: unknown): void {} export default function fbt(): never { throw new Error('fbt'); }"
          : 'import * as React from "react"; export * from "react"; export default React;',
      }));
    },
  };
  return esbuild.build({
    stdin: { contents: HARNESS, resolveDir: hostDir, loader: "tsx", sourcefile: "harness.tsx" },
    bundle: true, write: true, outfile: out, platform: "node", format: "esm",
    tsconfig, jsx: "automatic", plugins: [substitute], logLevel: "silent",
  });
}

function upstream(file, mode) {
  return babel.transformSync(fs.readFileSync(file, "utf8"), {
    filename: file, babelrc: false, configFile: false,
    parserOpts: { plugins: file.endsWith(".ts") ? ["typescript"] : ["typescript", "jsx"] },
    plugins: [[plugin, { panicThreshold: "none", compilationMode: mode, environment: { enableFunctionOutlining: false } }]],
  }).code;
}

async function run(fixturePath, text, name) {
  const out = path.join(work, name + ".mjs");
  try {
    await bundle(fixturePath, text, out);
  } catch (error) {
    return { unbuilt: String(error.message).split("\n").slice(0, 2).join(" ").slice(0, 200) };
  }
  const child = spawnSync(process.execPath, [out], { encoding: "utf8", timeout: 20000 });
  if (child.status !== 0 || !child.stdout) return { crashed: (child.stderr || "").split("\n").find((l) => /Error/.test(l)) || `exit ${child.status}` };
  return JSON.parse(child.stdout);
}

(async () => {
  const lines = fs.readFileSync(modeList, "utf8").trim().split("\n").map((l) => l.split(" "));
  // Ours, per mode, as the stage prints it.
  const ours = {};
  for (const mode of new Set(lines.map(([m]) => m))) {
    const options = JSON.parse(fs.readFileSync(path.join(study, `corpus/compile/options-${mode}.json`), "utf8"));
    options.environment = { enableFunctionOutlining: false };
    const optionsPath = path.join(work, `options-${mode}.json`);
    fs.writeFileSync(optionsPath, JSON.stringify(options));
    ours[mode] = path.join(work, "ours", mode);
    execFileSync(ntsReact, ["compile", path.join(setDir, "orig/tsconfig.json"), optionsPath, ours[mode], "--lower-jsx", "--typed-cache"], { stdio: ["ignore", "ignore", "inherit"] });
  }

  const tally = { agree: 0, differ: 0, notEvaluable: 0, upstreamDiffers: 0 };
  for (const [mode, file] of lines) {
    const name = path.basename(file);
    if (only && !name.includes(only)) continue;
    const source = fs.readFileSync(file, "utf8");
    if (!source.includes("FIXTURE_ENTRYPOINT") || source.includes("from 'fbt'") || source.includes('from "fbt"')) {
      tally.notEvaluable++;
      continue;
    }
    const oursText = fs.readFileSync(path.join(ours[mode], name), "utf8");
    const texts = {
      written: source,
      upstream: upstream(path.resolve(file), mode),
      ours: control ? oursText.replace(/(\]|\.s\d+) !== /g, "$1 === ") : oursText,
    };
    const results = {};
    for (const [variant, text] of Object.entries(texts)) results[variant] = await run(path.resolve(file), text, `${name}.${variant}`);
    const shown = Object.fromEntries(Object.entries(results).map(([v, r]) => [v, JSON.stringify(r)]));
    if (results.written.unbuilt || results.written.crashed) {
      tally.notEvaluable++;
      console.log(JSON.stringify({ file: name, notEvaluable: results.written }));
      continue;
    }
    const upstreamAgrees = shown.upstream === shown.written;
    if (!upstreamAgrees) tally.upstreamDiffers++;
    // Ours is held to the written program; where upstream itself departs
    // from it, to upstream as well, and the fixture is reported either way.
    if (shown.ours === shown.written || shown.ours === shown.upstream) {
      tally.agree++;
      if (process.env.EVALUATE_SHOW === "1") console.log(JSON.stringify({ file: name, ours: results.ours }).slice(0, 600));
      if (!upstreamAgrees) console.log(JSON.stringify({ file: name, upstreamDiffers: true, written: results.written, upstream: results.upstream }).slice(0, 600));
    } else {
      tally.differ++;
      console.log(JSON.stringify({ file: name, written: results.written, ours: results.ours }).slice(0, 800));
    }
  }
  console.log(JSON.stringify(tally));
  fs.rmSync(work, { recursive: true, force: true });
})();
