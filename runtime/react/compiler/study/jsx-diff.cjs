// The JSX lowering oracle: our lowered output against TypeScript's own
// `--jsx react-jsx` emit of the same program with its JSX left in.
//
// `nts-react compile` writes each file twice: <plain> keeps JSX, <lowered>
// was written with --lower-jsx. TypeScript transpiles <plain> with
// `react-jsx` and <lowered> with JSX preserved (it has none left); the two
// JavaScript texts, re-printed through one printer without comments, must be
// identical. A file with no JSX compares equal trivially and is counted apart.
//
// usage: node jsx-diff.cjs <plain-dir> <lowered-dir> <mode-list>
//   <mode-list> is lines of "<infer|all> <file>"; outputs are <dir>/<mode>/<file>.
//   JSX_CONTROL=1 runs the control arm (`react-jsxdev` on the plain side),
//   which must differ on every file with JSX.
const { parse } = require("@babel/parser");
const generate = require("@babel/generator").default;
// Resolved from the study workspace: the lane's own `typescript` is
// TypeScript 7, which has no JavaScript API.
const ts = require(require.resolve("typescript", { paths: [process.cwd()] }));
const fs = require("fs");
const path = require("path");

const [plainDir, loweredDir, modeList] = process.argv.slice(2);
const control = process.env.JSX_CONTROL === "1";

// Every import is kept (`verbatimModuleSyntax`): otherwise TypeScript elides
// `import fbt` on the lowered side, where `<fbt>` has become the string
// "fbt", and keeps it on the other. The runtime import's specifiers are
// sorted: TypeScript 5 lists them in first-use order and tsgo, which the
// lowering follows, sorts them; the order of named imports means nothing.
function runs(code, file, jsx) {
  const js = ts.transpileModule(code, {
    fileName: file,
    compilerOptions: { jsx, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
  }).outputText;
  const program = parse(js, { sourceType: "module", plugins: ["jsx"] });
  for (const statement of program.program.body) {
    if (statement.type === "ImportDeclaration" && statement.source.value === "react/jsx-runtime") {
      statement.specifiers.sort((a, b) => (a.local.name < b.local.name ? -1 : 1));
    }
  }
  forgetSpelling(program);
  return generate(program, { comments: false }).code;
}

// A string literal is compared by value: `"\u00B7"` and `"·"` are one string.
function forgetSpelling(node) {
  if (Array.isArray(node)) return node.forEach(forgetSpelling);
  if (!node || typeof node !== "object") return;
  if (node.type === "StringLiteral") delete node.extra;
  for (const key in node) if (key !== "loc") forgetSpelling(node[key]);
}

let identical = 0, differing = 0, invalid = 0, withoutJsx = 0;
for (const line of fs.readFileSync(modeList, "utf8").trim().split("\n")) {
  const [mode, file] = line.split(" ");
  const base = path.basename(file);
  const plain = fs.readFileSync(path.join(plainDir, mode, base), "utf8");
  const lowered = fs.readFileSync(path.join(loweredDir, mode, base), "utf8");
  let theirs, ours;
  try {
    // No JSX may be left: the lowered file must parse as plain TypeScript.
    parse(lowered, { sourceType: "module", plugins: ["typescript"] });
    theirs = runs(plain, base, control ? ts.JsxEmit.ReactJSXDev : ts.JsxEmit.ReactJSX);
    ours = runs(lowered, base.replace(/\.tsx$/, ".ts"), ts.JsxEmit.Preserve);
  } catch (error) {
    invalid++;
    console.log(JSON.stringify({ file: base, invalid: String(error.message).slice(0, 160) }));
    continue;
  }
  if (!/jsx-runtime|jsx-dev-runtime|_createElement/.test(theirs)) withoutJsx++;
  if (theirs === ours) {
    identical++;
    continue;
  }
  differing++;
  const al = theirs.split("\n"), bl = ours.split("\n");
  const at = al.findIndex((l, i) => l !== bl[i]);
  console.log(JSON.stringify({ file: base, line: at + 1, theirs: al[at], ours: bl[at] }));
}
console.log(JSON.stringify({ identical, differing, invalid, withoutJsx }));
