// The frontend oracle: our tsgo converter against Babel's own parse.
//
// For each file, parse it with @babel/parser (TypeScript, plus JSX for .tsx)
// and compare that AST with `nts-react convert`'s output node by node. Both
// are normalised first so that representation, not meaning, never counts:
//   - null, false and absent are the same, and so is an empty list of
//     attributes or decorators;
//   - a node in a typed field may lack \`type\` on our side;
//   - Babel's attached comments, `extra`, `range`, `tokens` and our `_nodeId`
//     are dropped (comments are compared as the file's list instead);
//   - a type, or a class member, is compared the way the compiler reads it:
//     its node type and span, and a type reference's name; so are the
//     statements the compiler does not model and passes through
//     (`import x = require()`, `export =`, `export as namespace`).
// Everything else -- every node type, every field, every start and end --
// must match.
//
// usage: node convert-diff.cjs <our-out-dir> <source-file>...
// prints one JSON line per file, then a summary of differences by kind.
const { parse } = require("@babel/parser");
const fs = require("fs");
const path = require("path");

const [ours, ...files] = process.argv.slice(2);
const DROP = new Set(["leadingComments", "trailingComments", "innerComments", "extra", "range", "tokens", "_nodeId", "errors", "identifierName", "filename"]);

// Is this node one the compiler only reads opaquely?
function opaque(node, parentKey) {
  if (typeof node.type !== "string") return false;
  if (parentKey === "typeAnnotation" && node.type !== "TSTypeAnnotation") return true;
  return /^TS.*(Type|Keyword)$|^TSType(Literal|Reference|Predicate|Operator|Query)$|^TSQualifiedName$|^TSTypeParameter(Declaration|Instantiation)$|^TSInterfaceBody$|^TSEnumMember$|^ClassMember$|^Class(Method|Property|PrivateProperty|PrivateMethod|AccessorProperty)$|^StaticBlock$|^TSIndexSignature$|^TSImportEqualsDeclaration$|^TSExportAssignment$|^TSNamespaceExportDeclaration$/.test(node.type);
}

function normalise(value, parentKey) {
  if (Array.isArray(value)) return value.map((v) => normalise(v, parentKey));
  if (value === null || typeof value !== "object") return value;
  if (opaque(value, parentKey)) {
    const kept = { type: value.type === "ClassMember" ? "ClassMember" : value.type, start: value.start, end: value.end };
    if (/^Class(Method|Property|PrivateProperty|PrivateMethod|AccessorProperty)$|^StaticBlock$|^TSIndexSignature$/.test(value.type)) kept.type = "ClassMember";
    if (value.type === "TSTypeReference" && value.typeName) kept.typeName = value.typeName.name ?? value.typeName.type;
    return kept;
  }
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (DROP.has(key) || v === null || v === false || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0 && key !== "body" && key !== "params" && key !== "arguments" && key !== "elements" && key !== "properties") continue;
    if (key === "loc") {
      out.loc = { start: [v.start.line, v.start.column], end: [v.end.line, v.end.column] };
      continue;
    }
    // A class body is compared by its span and member count; the members are
    // raw JSON the compiler reads only for a class inside a function.
    if (key === "body" && (value.type === "ClassDeclaration" || value.type === "ClassExpression")) {
      out.body = { start: v.start, end: v.end, memberCount: (v.body || []).length };
      continue;
    }
    out[key] = normalise(v, key);
  }
  return out;
}

const differences = new Map();
function diff(a, b, at, found) {
  if (found.length >= 12) return;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) {
    found.push({ at, babel: brief(a), ours: brief(b) });
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) found.push({ at: at + ".length", babel: a.length, ours: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${at}[${i}]`, found);
    return;
  }
  if (a !== null && typeof a === "object") {
    const where = a.type ? `${at}<${a.type}>` : at;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      // A node held in a typed field serialises without \`type\` on our side:
      // the Rust type already says what it is.
      if (key === "type" && key in a && !(key in b)) continue;
      if (!(key in a) || !(key in b)) found.push({ at: `${where}.${key}`, babel: brief(a[key]), ours: brief(b[key]) });
      else diff(a[key], b[key], `${where}.${key}`, found);
    }
    return;
  }
  if (a !== b) found.push({ at, babel: a, ours: b });
}
function brief(v) {
  if (v === undefined) return "(absent)";
  if (v && typeof v === "object") return v.type ? `<${v.type}>` : Array.isArray(v) ? `[${v.length}]` : "{…}";
  return v;
}
// "program.body[3]<ExportNamedDeclaration>.declaration<X>.start" -> "ExportNamedDeclaration.declaration<X>.start"
function kindOf(at) {
  const parts = at.split(/(?=<)/);
  return parts.slice(-2).join("").replace(/\[\d+\]/g, "[]").replace(/^[^<]*/, "");
}

let identical = 0, differing = 0, unsupported = 0, missing = 0;
for (const file of files) {
  const base = path.basename(file);
  const ourPath = path.join(ours, base + ".ast.json");
  if (!fs.existsSync(ourPath)) {
    const why = path.join(ours, base + ".unsupported.txt");
    if (fs.existsSync(why)) { unsupported++; console.log(JSON.stringify({ file: base, unsupported: fs.readFileSync(why, "utf8").trim() })); }
    else { missing++; console.log(JSON.stringify({ file: base, missing: true })); }
    continue;
  }
  const code = fs.readFileSync(file, "utf8");
  let babel;
  try {
    babel = parse(code, { sourceType: "module", plugins: file.endsWith(".ts") ? ["typescript"] : ["typescript", "jsx"] });
  } catch (error) {
    console.log(JSON.stringify({ file: base, babelFailed: String(error.message).slice(0, 120) }));
    continue;
  }
  const found = [];
  const b = normalise(babel), o = normalise(JSON.parse(fs.readFileSync(ourPath, "utf8")));
  // Comments are compared as the file's list, by text and span.
  const comments = (list) => (list || []).map((c) => `${c.type}@${c.start}-${c.end}:${c.value}`);
  diff(comments(babel.comments), comments(JSON.parse(fs.readFileSync(ourPath, "utf8")).comments), "comments", found);
  delete b.comments; delete o.comments;
  diff(b, o, "file", found);
  if (found.length === 0) identical++;
  else {
    differing++;
    for (const d of found) differences.set(kindOf(d.at), (differences.get(kindOf(d.at)) || 0) + 1);
  }
  console.log(JSON.stringify({ file: base, differences: found.slice(0, 5) }));
}
console.log(JSON.stringify({ identical, differing, unsupported, missing }));
console.log(JSON.stringify([...differences.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)));
