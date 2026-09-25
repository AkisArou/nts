// The printer oracle: our spliced output against upstream's plugin output.
//
// For each file, upstream's Babel plugin (Rust backend) produces its code,
// and `nts-react compile` writes ours. Both must parse as TypeScript; then
// types are stripped from each and the JavaScript is re-printed through one
// printer, so formatting, comments and types never count -- only what runs.
//
// RC_OUTLINE=0 compiles both sides with function outlining off.
// usage: node print-diff.cjs <our-out-dir> <mode-list>
//   <mode-list> is lines of "<infer|all> <file>".
//   PRINT_CONTROL=1 runs the control arm, which must differ.
const babel = require("@babel/core");
const { parse } = require("@babel/parser");
const generate = require("@babel/generator").default;
// Resolved from the study workspace the script runs in: the lane's own
// `typescript` is TypeScript 7, which has no JavaScript API.
const ts = require(require.resolve("typescript", { paths: [process.cwd()] }));
const fs = require("fs");
const path = require("path");

const PLUGIN = process.env.HOME + "/.cache/nts-react/upstream/compiler/packages/babel-plugin-react-compiler-rust/dist";
const plugin = require(PLUGIN).default;
const [ours, modeList] = process.argv.slice(2);

const syntax = (file) => (file.endsWith(".ts") ? ["typescript"] : ["typescript", "jsx"]);

// The JavaScript a TypeScript source runs as, printed one way.
function runs(code, file) {
  const js = ts.transpileModule(code, {
    fileName: file,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false },
  }).outputText;
  const program = parse(js, { sourceType: "module", plugins: ["jsx"] });
  forgetSpelling(program);
  return generate(program, { comments: false }).code;
}

// A string literal is compared by value: `"\xA9"` and `"©"` are one string,
// and a JSX attribute's `'a'` and `"a"` one value.
function forgetSpelling(node) {
  if (Array.isArray(node)) return node.forEach(forgetSpelling);
  if (!node || typeof node !== "object") return;
  if (node.type === "StringLiteral") delete node.extra;
  for (const key in node) if (key !== "loc") forgetSpelling(node[key]);
}

let identical = 0, differing = 0, invalid = 0;
for (const line of fs.readFileSync(modeList, "utf8").trim().split("\n")) {
  const [mode, file] = line.split(" ");
  const base = path.basename(file);
  const code = fs.readFileSync(file, "utf8");
  const theirs = babel.transformSync(code, {
    filename: file, babelrc: false, configFile: false,
    parserOpts: { plugins: syntax(file) },
    // The control arm: PRINT_CONTROL=1 compiles upstream's side in the other
    // mode, so a comparison that cannot see a change reports none.
    plugins: [[plugin, { panicThreshold: "none", compilationMode: process.env.PRINT_CONTROL === "1" ? (mode === "all" ? "infer" : "all") : mode, environment: { enableFunctionOutlining: process.env.RC_OUTLINE !== "0" } }]],
  }).code;
  const oursCode = fs.readFileSync(path.join(ours, mode, base), "utf8");
  try {
    parse(oursCode, { sourceType: "module", plugins: syntax(file) });
  } catch (error) {
    invalid++;
    console.log(JSON.stringify({ file: base, invalid: String(error.message).slice(0, 160) }));
    continue;
  }
  const [a, b] = [runs(theirs, file), runs(oursCode, file)];
  if (a === b) {
    identical++;
    continue;
  }
  differing++;
  const al = a.split("\n"), bl = b.split("\n");
  const at = al.findIndex((l, i) => l !== bl[i]);
  console.log(JSON.stringify({ file: base, line: at + 1, theirs: al[at], ours: bl[at] }));
}
console.log(JSON.stringify({ identical, differing, invalid }));
