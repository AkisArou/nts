// Typechecks a directory of modules in one program; per file prints
// diagnostic codes and the bindings whose type is any/unknown.
// usage: node measure.cjs <dir> <any|unknown> > out.json
const ts = require("typescript");
const fs = require("fs"), path = require("path");
const [dir, arm] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => path.resolve(dir, f));
const stubs = path.resolve(__dirname, "stubs");
const options = {
  strict: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], skipLibCheck: true, allowImportingTsExtensions: true,
  types: ["node"], typeRoots: [path.resolve(__dirname, "node_modules/@types")],
  baseUrl: __dirname,
  paths: { "react/compiler-runtime": [`stubs/cr-${arm}.ts`], "shared-runtime": ["stubs/shared-runtime.ts"] },
};
const program = ts.createProgram([...files, path.join(stubs, "fbt.d.ts")], options);
const checker = program.getTypeChecker();
const result = {};
for (const f of files) {
  const sf = program.getSourceFile(f);
  const diags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
  const loose = [];
  const visit = (node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) {
      const t = checker.getTypeAtLocation(node.name);
      if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
        loose.push({ name: node.name.text, type: checker.typeToString(t), kind: ts.SyntaxKind[node.kind] });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  result[path.basename(f)] = {
    diags: diags.map((d) => ({ code: d.code, msg: ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 160),
      line: d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0 })),
    loose,
  };
}
console.log(JSON.stringify(result));
