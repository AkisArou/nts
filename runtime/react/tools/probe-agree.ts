// Does the React stage change what a program does? The native probe's
// scenarios, run under node three ways, must answer alike:
//
//   plain     native/probe, which renders with createElement
//   written   native/compiled's TSX as written, JSX by esbuild
//   staged    native/compiled as nts reads it: every file the stage rewrote
//             (`nts-react stage`) in place of its source
//
// `staged` against `written` is the stage's own claim -- compiled, typed and
// lowered, the same behaviour -- and `written` against `plain` says the TSX
// probe is the probe. The control: each scenario must answer differently for
// different inputs, or agreement would say nothing.
//
// usage: node tools/probe-agree.ts
//   NTS_REACT names the nts-react binary (default: the lane's debug build),
//   NTS_TSGO the tsgo it drives.

import { build, type Plugin } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const lane = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plainProbe = join(lane, "native/probe");
const compiledProbe = join(lane, "native/compiled");
const ntsReact = process.env.NTS_REACT ?? join(process.env.HOME ?? "", ".cache/nts-react/target/debug/nts-react");

/** Each scenario, with the inputs it runs at. */
const scenarios: Record<string, unknown[][]> = {
  keyedReorder: [[1], [3], [5]],
  stateAfterEffect: [[0], [4]],
  changedHookOrder: [[0], [4]],
  classLifecycles: [[0], [5]],
  errorBoundary: [[1], [2]],
  pureSkip: [[0], [1], [2]],
};

/** What a scenario's every answer must contain, where agreeing is not enough. */
const expected: Record<string, string> = {
  // The native build's hook-kind check, which three variants without it
  // would agree on missing.
  changedHookOrder: "Rendered a different hook than during the previous render",
};

type Module = Record<string, (...args: unknown[]) => unknown>;

/** Bundles `entry` as its project resolves it, with `replace` substituting files, and imports it. */
async function load(entry: string, tsconfig: string, work: string, replace: Map<string, string> = new Map()): Promise<Module> {
  const substitute: Plugin = {
    name: "substitute",
    setup(on) {
      on.onLoad({ filter: /\.tsx?$/ }, (args) => {
        const text = replace.get(args.path);
        return text === undefined ? undefined : { contents: text, loader: args.path.endsWith(".tsx") ? "tsx" : "ts" };
      });
    },
  };
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    tsconfig,
    jsx: "automatic",
    plugins: [substitute],
    logLevel: "error",
  });
  const file = join(work, `${basename(dirname(dirname(entry)))}-${replace.size}.mjs`);
  writeFileSync(file, result.outputFiles[0]!.contents);
  return (await import(pathToFileURL(file).href)) as Module;
}

function run(module: Module): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(scenarios).map(([name, inputs]) => [name, inputs.map((args) => String(module[name]!(...args)))]),
  );
}

const work = mkdtempSync(join(tmpdir(), "probe-agree-"));
try {
  // The stage's output, as nts reads it: only the files it rewrote.
  const staged = join(work, "staged");
  execFileSync(ntsReact, ["stage", join(compiledProbe, "tsconfig.json"), staged], { stdio: ["ignore", "ignore", "inherit"] });
  const replace = new Map<string, string>();
  for (const name of ["main.tsx", "ReactFiberConfig.ts", "SchedulerHost.ts"]) {
    const rewritten = join(staged, name);
    if (existsSync(rewritten)) replace.set(join(compiledProbe, "src", name), readFileSync(rewritten, "utf8"));
  }
  if (!replace.has(join(compiledProbe, "src/main.tsx"))) throw new Error("the stage wrote no main.tsx: nothing would be compared");
  // The compiler's cache, as an array (`_c(n)`) or typed (`_cacheOf(shape)`).
  if (!/\b_c\(|\b_cacheOf\(/.test(replace.get(join(compiledProbe, "src/main.tsx"))!)) throw new Error("the staged main.tsx memoizes nothing: the compiler did not run");
  // Its class components, as descriptors (CLASS-COMPONENTS.md).
  if (!/static readonly \$\$type = /.test(replace.get(join(compiledProbe, "src/main.tsx"))!)) throw new Error("the staged main.tsx describes no class: the stage wrote no descriptor");

  // The plain and written arms keep upstream's model of a class component:
  // its type is the class, asked about with `typeof`. The staged arm keeps
  // the native build's, where it is the descriptor alone, so it runs what an
  // nts build runs.
  const upstreamModel = new Map<string, string>();
  const twins: [native: string, js: string][] = [
    ["packages/react-reconciler/src/ReactFiberClassComponentHost.native.ts", "packages/react-reconciler/src/ReactFiberClassComponentHost.ts"],
    ["packages/react/src/ReactBaseClasses.native.ts", "packages/react/src/ReactBaseClasses.ts"],
  ];
  for (const [native, js] of twins) {
    upstreamModel.set(join(lane, native), readFileSync(join(lane, js), "utf8"));
  }

  const answers = {
    plain: run(await load(join(plainProbe, "src/main.ts"), join(plainProbe, "tsconfig.json"), work, upstreamModel)),
    written: run(await load(join(compiledProbe, "src/main.tsx"), join(compiledProbe, "tsconfig.json"), work, upstreamModel)),
    staged: run(await load(join(compiledProbe, "src/main.tsx"), join(compiledProbe, "tsconfig.json"), work, replace)),
  };

  let failures = 0;
  for (const [name, inputs] of Object.entries(scenarios)) {
    const [plain, written, staged] = [answers.plain[name]!, answers.written[name]!, answers.staged[name]!];
    inputs.forEach((args, at) => {
      const agree = plain[at] === written[at] && written[at] === staged[at];
      if (!agree) failures++;
      console.log(`${agree ? "ok  " : "DIFF"} ${name}(${args.join(", ")})${agree ? `  ${staged[at]}` : `\n  plain   ${plain[at]}\n  written ${written[at]}\n  staged  ${staged[at]}`}`);
    });
    const want = expected[name];
    if (want !== undefined && !staged.every((answer) => answer.includes(want))) {
      failures++;
      console.log(`EXPECTED ${name} to say ${JSON.stringify(want)}`);
    }
    // The control: a scenario whose answer does not depend on its input
    // agrees with anything.
    if (new Set(staged).size < 2) {
      failures++;
      console.log(`CONTROL ${name} answers ${JSON.stringify(staged[0])} for every input`);
    }
  }
  console.log(failures === 0 ? "the stage keeps the probe's behaviour" : `${failures} disagreement(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
