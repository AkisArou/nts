// Study prototype: compile with the Rust React Compiler, then restore types
// on the output by source span, from the ORIGINAL program's checker.
// usage: node retype.cjs <in> <out>   (prints a JSON line of what it did)
const babel = require("@babel/core");
const { parse } = require("@babel/parser");
const generate = require("@babel/generator").default;
const ts = require("typescript");
const fs = require("fs"), path = require("path");
const plugin = require(process.env.HOME + "/.cache/nts-react/upstream/compiler/packages/babel-plugin-react-compiler-rust/dist").default;

const [inp, outPath] = process.argv.slice(2);
const code = fs.readFileSync(inp, "utf8");
const isTsx = !inp.endsWith(".ts");
const stats = { temps: 0, tempsUntyped: 0, params: 0, typeArgs: 0, cacheReads: 0, unprintable: 0 };

// The original program, with the same options measure.cjs uses.
const options = {
  strict: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], skipLibCheck: true,
  types: ["node"], typeRoots: [path.resolve(__dirname, "node_modules/@types")], baseUrl: __dirname,
  paths: { "react/compiler-runtime": ["stubs/cr-unknown.ts"], "shared-runtime": ["stubs/shared-runtime.ts"] },
};
const program = ts.createProgram([path.resolve(inp), path.resolve(__dirname, "stubs/fbt.d.ts")], options);
const checker = program.getTypeChecker();
const sf = program.getSourceFile(path.resolve(inp));

// span "l:c-l:c" (Babel convention: 1-based lines) -> TS nodes, outermost first
const bySpan = new Map();
const key = (s, e) => {
  const a = sf.getLineAndCharacterOfPosition(s), b = sf.getLineAndCharacterOfPosition(e);
  return `${a.line + 1}:${a.character}-${b.line + 1}:${b.character}`;
};
(function index(n) {
  const add = (k, node) => { if (!bySpan.has(k)) bySpan.set(k, []); bySpan.get(k).push(node); };
  if (n !== sf) {
    add(key(n.getStart(sf), n.getEnd()), n);
    // Babel starts a declaration after its modifiers (`export`, `async` stays)
    const mods = ts.canHaveModifiers(n) && ts.getModifiers(n);
    if (mods && mods.length) {
      const first = mods.find((m) => m.kind !== ts.SyntaxKind.ExportKeyword && m.kind !== ts.SyntaxKind.DefaultKeyword);
      const start = first ? first.getStart(sf) : ts.skipTrivia(sf.text, mods[mods.length - 1].getEnd());
      add(key(start, n.getEnd()), n);
    }
    // Babel's identifier span includes its annotation and definite `!`
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && n.type && ts.isIdentifier(n.name))
      add(key(n.name.getStart(sf), n.type.getEnd()), n.name);
  }
  ts.forEachChild(n, index);
})(sf);
const locKey = (loc) => loc && loc.end ? `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}` : null;
const at = (loc) => bySpan.get(locKey(loc)) || [];

const FLAGS = ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseFullyQualifiedType;
function typeText(node) {
  const t = checker.getTypeAtLocation(node);
  const s = checker.typeToString(t, node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType);
  return /\.\.\.|__type|typeof import/.test(s) ? null : s;
}
function typeNode(text) {
  const f = parse(`let _: ${text};`, { sourceType: "module", plugins: ["typescript", "jsx"] });
  return f.program.body[0].declarations[0].id.typeAnnotation;
}

const r = babel.transformSync(code, { filename: inp, babelrc: false, configFile: false, ast: true, code: false,
  parserOpts: { plugins: isTsx ? ["typescript", "jsx"] : ["typescript"] },
  plugins: [[plugin, { panicThreshold: "none", compilationMode: process.env.RC_MODE || "infer",
    environment: { enableFunctionOutlining: process.env.RC_OUTLINE !== "0" } }]] });

const annotated = new Set();
babel.traverse(r.ast, {
  // (a) `let t1;` -> `let t1: T;` from the original expression at t1's span
  VariableDeclarator(p) {
    const id = p.node.id;
    if (id.type !== "Identifier" || id.typeAnnotation) return;
    if (p.node.init) {
      // (e) a named local's own annotation, which lowering keeps only as a node kind
      const decl = at(id.loc).map((n) => n.parent).find((n) => n && ts.isVariableDeclaration(n) && n.type);
      if (decl) { id.typeAnnotation = typeNode(decl.type.getText(sf)); stats.localAnnotations = (stats.localAnnotations || 0) + 1; }
      return;
    }
    const head = p.parentPath.parentPath;
    if (head && (head.isForOfStatement() || head.isForInStatement())) return;
    stats.temps++;
    const cands = at(id.loc).filter((n) => ts.isExpression(n) || ts.isIdentifier(n) || ts.isVariableDeclaration(n)
      || ts.isBindingElement(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n));
    const node = cands[0];
    const declared = at(id.loc).map((n) => n.parent).find((n) => n && ts.isVariableDeclaration(n));
    if (declared && declared.exclamationToken) p.node.definite = true;
    const text = node && (declared && declared.type ? declared.type.getText(sf)
      : typeText(ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) ? node.name : node));
    if (!text) { stats.tempsUntyped++; return; }
    id.typeAnnotation = typeNode(text); annotated.add(id.name);
  },
  // (b) parameters: restore the original parameter's annotation
  Function(p) {
    for (const prm of p.node.params) {
      const id = prm.type === "AssignmentPattern" ? prm.left : prm.type === "RestElement" ? prm.argument : prm;
      if (id.typeAnnotation || prm.typeAnnotation) continue;
      const orig = at(prm.loc).find(ts.isParameter) || at(id.loc).find(ts.isParameter)
        || at(id.loc).map((n) => n.parent).find((n) => n && ts.isParameter(n));
      if (!orig) continue;
      const text = orig.type ? orig.type.getText(sf) : typeText(orig.name);
      if (!text) { stats.unprintable++; continue; }
      if (prm.type === "RestElement") prm.typeAnnotation = typeNode(text); else id.typeAnnotation = typeNode(text);
      if ((orig.questionToken || orig.initializer) && prm.type === "Identifier") id.optional = true;
      stats.params++;
    }
    // (h) local type declarations of the original body, re-inserted at the top
    const fn = at(p.node.loc).find((n) => ts.isFunctionLike(n));
    if (fn && fn.body && ts.isBlock(fn.body) && p.node.body.type === "BlockStatement") {
      const have = new Set(p.node.body.body.filter((st) => st.type === "TSTypeAliasDeclaration" || st.type === "TSInterfaceDeclaration").map((st) => st.id.name));
      const lost = fn.body.statements.filter((st) => (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) && !have.has(st.name.text));
      if (lost.length) {
        const decls = parse(lost.map((st) => st.getText(sf)).join("\n"), { sourceType: "module", plugins: ["typescript"] }).program.body;
        p.get("body").unshiftContainer("body", decls); stats.localTypes = (stats.localTypes || 0) + lost.length;
      }
    }
    // (f) type parameters and return type (incl. predicates) of the function the user wrote here
    if (fn) {
      if (fn.typeParameters && !p.node.typeParameters) {
        const tp = parse(`function f<${fn.typeParameters.map((t) => t.getText(sf)).join(", ")}>() {}`, { plugins: ["typescript"] });
        p.node.typeParameters = tp.program.body[0].typeParameters; stats.typeParams = (stats.typeParams || 0) + 1;
      }
      if (fn.type && !p.node.returnType) {
        const params = fn.parameters.map((q) => q.name.getText(sf)).join(", ");
        const f = parse(`function f(${params}): ${fn.type.getText(sf)} {}`, { plugins: ["typescript"] });
        p.node.returnType = f.program.body[0].returnType; stats.returnTypes = (stats.returnTypes || 0) + 1;
      }
    } else if (p.node.id && /^_temp/.test(p.node.id.name)) {
      stats.outlinedUnmatched = (stats.outlinedUnmatched || 0) + 1;
    }
  },
  // (c) explicit type arguments the lowering dropped
  "CallExpression|OptionalCallExpression|NewExpression"(p) {
    if (p.node.typeParameters || p.node.typeArguments) return;
    const orig = at(p.node.loc).find((n) => (ts.isCallExpression(n) || ts.isNewExpression(n)) && n.typeArguments);
    if (!orig) return;
    const args = parse(`f<${orig.typeArguments.map((t) => t.getText(sf)).join(", ")}>()`, { plugins: ["typescript"] });
    p.node.typeParameters = args.program.body[0].expression.typeParameters; stats.typeArgs++;
  },
  // (g) `x!` and `f<T>`: wrap the node whose span is the operand of one the user wrote
  "Expression"(p) {
    if (!p.node.loc || p.node._restored) return;
    const orig = at(p.node.loc).map((n) => n.parent).find((n) => n && (ts.isNonNullExpression(n) || ts.isExpressionWithTypeArguments(n)) && n.expression && key(n.expression.getStart(sf), n.expression.getEnd()) === locKey(p.node.loc));
    if (!orig || p.parentPath.isTSNonNullExpression() || p.parentPath.isTSInstantiationExpression()) return;
    p.node._restored = true;
    if (ts.isNonNullExpression(orig)) { p.replaceWith(babel.types.tsNonNullExpression(p.node)); stats.nonNull = (stats.nonNull || 0) + 1; }
    else {
      const ta = parse(`f<${orig.typeArguments.map((t) => t.getText(sf)).join(", ")}>`, { plugins: ["typescript"] }).program.body[0].expression;
      p.replaceWith(babel.types.tsInstantiationExpression(p.node, ta.typeParameters)); stats.instantiation = (stats.instantiation || 0) + 1;
    }
  },
  TSAsExpression(p) {
    // `t0 as const` after the literal moved into t0: t0's annotation already carries the const type
    const tn = p.node.typeAnnotation;
    if (p.node.expression.type === "Identifier" && tn.type === "TSTypeReference" && tn.typeName.name === "const") {
      p.replaceWith(p.node.expression); stats.detachedConst = (stats.detachedConst || 0) + 1;
    }
  },
  // (d) `x = $[k]` -> `x = $[k] as typeof x`
  AssignmentExpression(p) {
    const { left, right } = p.node;
    if (left.type === "Identifier" && right.type === "MemberExpression" && right.object.type === "Identifier" && right.object.name === "$") {
      p.node.right = babel.types.tsAsExpression(right, babel.types.tsTypeQuery(babel.types.identifier(left.name)));
      stats.cacheReads++;
    }
  },
});
fs.writeFileSync(outPath, generate(r.ast, { retainLines: false }).code);
console.log(JSON.stringify({ file: path.basename(inp), ...stats }));
