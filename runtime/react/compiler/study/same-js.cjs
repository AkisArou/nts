// Strips types from the plain and the re-typed output of each file, then
// compares the JavaScript. Any difference means a restoration changed behaviour.
const ts = require("typescript"), fs = require("fs"), path = require("path");
const [plainDir, typedDir] = process.argv.slice(2);
const strip0 = (f) => ts.transpileModule(fs.readFileSync(f, "utf8"), { fileName: f,
  compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false } }).outputText
  ;
const { parse } = require("@babel/parser");
const gen = require("@babel/generator").default;
const norm = (f) => gen(parse(strip0(f), { sourceType: "module", plugins: ["jsx"] }), { comments: false }).code;
let same = 0, diff = [];
for (const f of fs.readdirSync(typedDir).filter((f) => /\.tsx?$/.test(f))) {
  if (!fs.existsSync(path.join(plainDir, f))) continue;
  norm(path.join(plainDir, f)) === norm(path.join(typedDir, f)) ? same++ : diff.push(f);
}
console.log(`identical JS: ${same}; different: ${diff.length}`, diff.slice(0, 10));
