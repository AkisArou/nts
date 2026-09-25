// The scope oracle: our ScopeInfo against the one upstream's Babel plugin
// builds (babel-plugin-react-compiler-rust/src/scope.ts), file by file.
//
// Node ids differ between the two sides (tsgo's against Babel's counter), but
// the ASTs are identical (convert-diff.cjs), so every node is named by its
// span instead: `start-end`, and an identifier also by its name. Then:
//   - scopes are compared in order: kind, parent, the node they belong to,
//     and their binding names;
//   - bindings in order: name, kind, scope, declaration type and start,
//     import details;
//   - references as a set of (identifier span and name -> binding);
//   - the scope of each scope node.
// References from inside types and the TypeScript module forms are counted
// apart: the compiler takes those subtrees as raw JSON it never walks.
//
// usage: node scope-diff.cjs <our-out-dir> <source-file>...     (compare)
//        node scope-diff.cjs --dump <source-file>                 (Babel's side only)
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const PLUGIN = process.env.HOME + "/.cache/nts-react/upstream/compiler/packages/babel-plugin-react-compiler-rust/dist";
const { extractScopeInfo } = require(PLUGIN + "/scope");

// Babel's side: parse, run extractScopeInfo on the program path, keep the AST
// with the _nodeIds it assigned.
function babelSide(file) {
  const code = fs.readFileSync(file, "utf8");
  const ast = babel.parseSync(code, {
    filename: file, babelrc: false, configFile: false,
    parserOpts: { plugins: file.endsWith(".ts") ? ["typescript"] : ["typescript", "jsx"] },
  });
  let scope;
  babel.traverse(ast, { Program(programPath) { scope = extractScopeInfo(programPath); programPath.stop(); } });
  return { ast, scope };
}

// Where the compiler takes a subtree as raw JSON it never walks: types, and
// the TypeScript module forms it passes through. Babel resolves identifiers
// there (`Dispatch<…>`, `typeof p`, `v is string`, `export = f`), but no entry
// for one can reach the compiler, so such references are counted apart.
const OPAQUE_KEYS = new Set(["typeAnnotation", "returnType", "typeParameters", "superTypeParameters", "implements", "predicate"]);
const OPAQUE_TYPES = new Set(["TSImportEqualsDeclaration", "TSExportAssignment", "TSNamespaceExportDeclaration", "TSTypeAliasDeclaration", "TSInterfaceDeclaration"]);

// node id -> "start-end[:name]", and the ids inside opaque subtrees
function nodeNames(ast) {
  const names = new Map();
  const opaque = new Set();
  (function walk(node, inOpaque) {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, inOpaque));
    if (!node || typeof node !== "object") return;
    const here = inOpaque || OPAQUE_TYPES.has(node.type);
    if (node._nodeId != null && node.start != null) {
      const name = node.name != null && typeof node.name === "string" ? `:${node.name}` : "";
      names.set(node._nodeId, `${node.start}-${node.end}${name}`);
      if (here) opaque.add(node._nodeId);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== "loc" && value && typeof value === "object") walk(value, here || OPAQUE_KEYS.has(key));
    }
  })(ast, false);
  return { names, opaque };
}

function normalise(ast, scope) {
  const { names, opaque } = nodeNames(ast);
  const nodeOf = (id) => names.get(Number(id)) ?? `?${id}`;
  const scopeNode = new Map(Object.entries(scope.nodeIdToScope).map(([node, s]) => [s, nodeOf(node)]));
  const bindingName = (id) => {
    const b = scope.bindings[id];
    return b ? `${b.name}@${b.declarationStart}` : `?${id}`;
  };
  return {
    scopes: scope.scopes.map((s) => `${s.id} ${s.kind} parent=${s.parent} node=${scopeNode.get(s.id) ?? "-"} bindings=[${Object.keys(s.bindings).sort().join(",")}]`),
    bindings: scope.bindings.map((b) => `${b.name} ${b.kind} scope=${b.scope} ${b.declarationType}@${b.declarationStart}${b.import ? ` import(${b.import.source} ${b.import.kind} ${b.import.imported ?? ""})` : ""}`),
    references: [...new Set(Object.entries(scope.refNodeIdToBinding).filter(([node]) => !opaque.has(Number(node))).map(([node, b]) => `${nodeOf(node)} -> ${bindingName(b)}`))].sort(),
    opaqueReferences: Object.keys(scope.refNodeIdToBinding).filter((node) => opaque.has(Number(node))).length,
  };
}

function compareLists(label, babelList, ourList, found) {
  const length = Math.max(babelList.length, ourList.length);
  for (let i = 0; i < length && found.length < 10; i++) {
    if (babelList[i] !== ourList[i]) found.push({ [label]: i, babel: babelList[i] ?? "(none)", ours: ourList[i] ?? "(none)" });
  }
}

const args = process.argv.slice(2);
if (args[0] === "--dump") {
  const { ast, scope } = babelSide(args[1]);
  console.log(JSON.stringify(normalise(ast, scope), null, 1));
  process.exit(0);
}
const [ours, ...files] = args;
let identical = 0, differing = 0, missing = 0, opaqueOnly = 0;
const kinds = new Map();
for (const file of files) {
  const base = path.basename(file);
  const ourAst = path.join(ours, base + ".ast.json"), ourScope = path.join(ours, base + ".scope.json");
  if (!fs.existsSync(ourScope)) { missing++; continue; }
  const theirs = babelSide(file);
  const b = normalise(theirs.ast, theirs.scope);
  const o = normalise(JSON.parse(fs.readFileSync(ourAst, "utf8")), JSON.parse(fs.readFileSync(ourScope, "utf8")));
  const found = [];
  compareLists("scope", b.scopes, o.scopes, found);
  compareLists("binding", b.bindings, o.bindings, found);
  const theirRefs = new Set(b.references), ourRefs = new Set(o.references);
  for (const r of b.references) if (!ourRefs.has(r) && found.length < 14) found.push({ reference: "missing", babel: r });
  for (const r of o.references) if (!theirRefs.has(r) && found.length < 14) found.push({ reference: "extra", ours: r });
  opaqueOnly += b.opaqueReferences;
  if (found.length === 0) identical++;
  else {
    differing++;
    for (const d of found) {
      const kind = d.scope !== undefined ? "scope" : d.binding !== undefined ? "binding" : `reference ${d.reference}`;
      kinds.set(kind, (kinds.get(kind) || 0) + 1);
    }
  }
  console.log(JSON.stringify({ file: base, differences: found }));
}
// The TypeScript module forms bind names the compiler never sees; their
// bindings are the one scope difference this oracle expects.
console.log(JSON.stringify({ identical, differing, missing, referencesInsideTypesBabelOnly: opaqueOnly }));
console.log(JSON.stringify([...kinds.entries()]));
