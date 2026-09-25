// The end-to-end frontend oracle: the React Compiler on our tsgo-converted
// input against the same compiler on Babel's input.
//
// Upstream's Babel plugin runs over each file, and every call it makes into
// the compiler's napi addon is intercepted: that gives upstream's result on
// Babel's AST and scope, and the plugin's resolved options. `nts-react
// compile` then compiles the same file from our converter and scope builder
// with those options, and the two results are compared:
//   - the result's kind, and the events it logged (which functions compiled,
//     which bailed out, and why);
//   - the compiled program, normalised as convert-diff.cjs normalises an AST.
//
// RC_OUTLINE=0 compiles both sides with function outlining off.
// usage: node compile-diff.cjs <nts-react> <tsconfig.json> <work-dir> <mode-list>
//   COMPILE_CONTROL=1 runs the control arm, which must differ.
//   <mode-list> is lines of "<infer|all> <file>", the mode each file compiles in.
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PLUGIN = process.env.HOME + "/.cache/nts-react/upstream/compiler/packages/babel-plugin-react-compiler-rust";
const bridge = require(PLUGIN + "/dist/bridge");
const napi = require(PLUGIN + "/native");
const plugin = require(PLUGIN + "/dist").default;

const [binary, tsconfig, work, modeList] = process.argv.slice(2);
fs.mkdirSync(work, { recursive: true });
const modes = fs.readFileSync(modeList, "utf8").trim().split("\n").map((line) => line.split(" "));

// Upstream's side, and the options it resolved.
let captured = null;
const original = bridge.compileWithRust;
bridge.compileWithRust = (ast, scopeInfo, options, code) => {
  const input = JSON.stringify(code != null ? { ...options, __sourceCode: code } : options);
  captured = { options, result: napi.compile(JSON.stringify(ast), JSON.stringify(scopeInfo), input) };
  return original(ast, scopeInfo, options, code);
};
function upstream(file, mode) {
  captured = null;
  babel.transformSync(fs.readFileSync(file, "utf8"), {
    filename: file, babelrc: false, configFile: false,
    parserOpts: { plugins: file.endsWith(".ts") ? ["typescript"] : ["typescript", "jsx"] },
    plugins: [[plugin, { panicThreshold: "none", compilationMode: mode, environment: { enableFunctionOutlining: process.env.RC_OUTLINE !== "0" } }]],
  });
  return captured;
}

const DROP = new Set(["leadingComments", "trailingComments", "innerComments", "extra", "range", "tokens", "_nodeId", "identifierName", "filename", "loc", "comments", "timing", "orderedLog"]);
// The subtrees the compiler takes as raw JSON and passes through without
// reading -- types, class and enum members, the TypeScript module forms --
// are compared as convert-diff.cjs compares them: by type and span. The
// output printer copies them from the source by that span.
function opaque(node, parentKey) {
  if (typeof node.type !== "string") return parentKey === "typeAnnotation" || parentKey === "members";
  if (parentKey === "typeAnnotation" && node.type !== "TSTypeAnnotation") return true;
  return /^TS.*(Type|Keyword)$|^TSType(Literal|Reference|Predicate|Operator|Query)$|^TSQualifiedName$|^TSTypeParameter(Declaration|Instantiation)$|^TSInterfaceBody$|^TSEnumMember$|^ClassMember$|^Class(Method|Property|PrivateProperty|PrivateMethod|AccessorProperty)$|^StaticBlock$|^TSIndexSignature$|^TSImportEqualsDeclaration$|^TSExportAssignment$|^TSNamespaceExportDeclaration$/.test(node.type);
}
function normalise(value, parentKey) {
  if (Array.isArray(value)) return value.map((v) => normalise(v, parentKey));
  if (value === null || typeof value !== "object") return value;
  if (opaque(value, parentKey)) return { start: value.start, end: value.end };
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (DROP.has(key) || v === null || v === false || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0 && !["body", "params", "arguments", "elements", "properties", "expressions", "quasis"].includes(key)) continue;
    out[key] = normalise(v, key);
  }
  // A node in a typed field serialises without `type` on our side.
  delete out.type;
  return out;
}
function firstDifference(a, b, at = "") {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return `${at}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${at}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && typeof a === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference(a[key], b[key], `${at}.${key}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}
const eventKinds = (result) => (result.events || []).map((e) => e.kind).join(",");

// Our side: one `nts-react compile` per mode, with that mode's options.
const byMode = new Map();
for (const [mode, file] of modes) {
  if (!byMode.has(mode)) byMode.set(mode, []);
  byMode.get(mode).push(file);
}
const results = [];
for (const [mode, files] of byMode) {
  const probe = upstream(files[0], mode);
  if (!probe) throw new Error(`no compiler call for ${files[0]} in mode ${mode}`);
  const optionsPath = path.join(work, `options-${mode}.json`);
  const { __sourceCode, ...options } = probe.options;
  // The control arm: COMPILE_CONTROL=1 compiles our side in the other mode,
  // so a comparison that cannot see a change in compiled code reports none.
  if (process.env.COMPILE_CONTROL === "1") options.compilationMode = mode === "all" ? "infer" : "all";
  fs.writeFileSync(optionsPath, JSON.stringify(options));
  const out = path.join(work, mode);
  execFileSync(binary, ["compile", tsconfig, optionsPath, out], { stdio: ["ignore", "ignore", "inherit"] });
  for (const file of files) {
    const theirs = upstream(file, mode);
    const oursPath = path.join(out, path.basename(file) + ".result.json");
    if (!theirs || !fs.existsSync(oursPath)) {
      results.push({ file: path.basename(file), mode, missing: !theirs ? "upstream" : "ours" });
      continue;
    }
    const t = JSON.parse(theirs.result), o = JSON.parse(fs.readFileSync(oursPath, "utf8"));
    const difference =
      t.kind !== o.kind ? `kind: ${t.kind} vs ${o.kind}`
      : eventKinds(t) !== eventKinds(o) ? `events: ${eventKinds(t)} vs ${eventKinds(o)}`
      : firstDifference(normalise(t.ast), normalise(o.ast), "ast");
    results.push({ file: path.basename(file), mode, events: eventKinds(t), difference });
  }
}
for (const r of results) console.log(JSON.stringify(r));
const identical = results.filter((r) => !r.missing && !r.difference).length;
console.log(JSON.stringify({ files: results.length, identical, differing: results.filter((r) => r.difference).length, missing: results.filter((r) => r.missing).length }));
