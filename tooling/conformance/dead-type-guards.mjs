// `typeof x !== "T"` guards whose parameter is already declared `T`.
//
//   node tooling/conformance/dead-type-guards.mjs
//
// # Why this is its own question
//
// `os.setPriority(0, "x")` answered `ERR_OUT_OF_RANGE` where node answers
// `ERR_INVALID_ARG_TYPE`. `validateInt32` opens with `typeof value !== "number"`
// and its parameter was declared `number`, so the compiled lane folded the branch
// away and the next check answered instead. The interpreted lane passed the same
// test throughout, because there the guard still runs.
//
// A guard like that is a **type-error message waiting to be wrong**. It is not a
// dead branch in the ordinary sense -- a value of the wrong type really does
// arrive, because an overloaded function's wrapper checks only its first argument
// (`blockers/only-an-overloads-first-argument-is-checked`), and because node's own
// tests pass whatever they like. The declaration is what is wrong, not the guard.
//
// # This lists candidates, and a candidate is not a defect
//
// It matches on syntax within a file, so it will point at a guard whose parameter
// is shadowed, whose declaration belongs to a different function of the same
// parameter name, or which nothing can ever reach with a wrong type. **Every row
// needs a person to read it**, and the ones that matter are the guards reachable
// from a published export.
//
// What it cannot see is the reverse and more dangerous shape: a validator whose
// parameter is correctly `unknown` but whose *caller* passes a concretely-typed
// local. That is what `os.setPriority` actually was -- widening the validator
// changed nothing and widening the call site fixed it -- and it cannot be found by
// looking at the validator at all. Read a row here as "this file has the pattern",
// then follow the call site.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A tree to scan, so the sweep can be pointed at an older checkout and shown to
// find the case it was built from. Without that it is a check with no
// demonstrated failure.
const ROOT = process.argv[2] ?? "runtime/node";
const SCALARS = new Set(["number", "string", "boolean", "bigint", "symbol", "function", "object", "undefined"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "test") continue;
      yield* walk(p);
    } else if (entry.endsWith(".ts")) {
      yield p;
    }
  }
}

/**
 * The parameter list of the nearest `function` above `index`, as one string.
 *
 * Walks back to the nearest line that opens a function declaration, then forward
 * until the parentheses balance, so a signature broken across lines is still read
 * whole. Returns null when no opener is found, which drops the row rather than
 * guessing -- a guard this cannot place is one it should not report.
 */
const NOT_A_FUNCTION = new Set([
  "if", "while", "for", "switch", "catch", "return", "typeof", "do", "else",
  "throw", "await", "new", "delete", "void", "in", "of", "case",
]);

function enclosingSignature(lines, index) {
  for (let j = index; j >= 0 && index - j < 400; j--) {
    // The opener's *name* matters. A first version tested only for `<ident>(` and
    // matched the guard's own `if (`, so it read the condition as the parameter
    // list and dropped the row. That took a 199-row sweep to 4 and made it look
    // like a precision win -- until the control run against the source the sweep
    // was built from came back with nothing at all.
    const opener = /function\s+([A-Za-z_$][\w$]*)\s*\(|^\s*(?:export\s+)?(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(?:\*\s*)?([A-Za-z_$][\w$]*)\s*\(/.exec(lines[j]);
    if (opener === null) continue;
    const openerName = opener[1] ?? opener[2];
    if (NOT_A_FUNCTION.has(openerName)) continue;
    const open = lines[j].indexOf("(", opener.index);
    if (open < 0) continue;
    let depth = 0;
    let out = "";
    for (let k = j; k < lines.length && k - j < 40; k++) {
      const from = k === j ? open : 0;
      for (let c = from; c < lines[k].length; c++) {
        const ch = lines[k][c];
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) return out;
        }
        if (depth >= 1) out += ch;
      }
      out += " ";
    }
    return out;
  }
  return null;
}

const rows = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // `typeof name !== "T"` and `typeof name === "T"` alike: both are folded if
    // the declaration already settles the answer.
    const m = /typeof\s+([A-Za-z_$][\w$]*)\s*(!==|===)\s*"([a-z]+)"/.exec(lines[i]);
    if (m === null) continue;
    const [, name, op, wanted] = m;
    if (!SCALARS.has(wanted)) continue;

    // The declaration has to be the **enclosing function's**, not any in the file.
    // Matching file-wide called `win32.toNamespacedPath(path: unknown)` a dead
    // guard, because some other function in that file takes a `path: string`. The
    // reverse error is just as easy: a file where the concrete declaration is the
    // real one and a nearby `unknown` hides it.
    const signature = enclosingSignature(lines, i);
    if (signature === null) continue;
    const decl = new RegExp(`\\b${name}\\??\\s*:\\s*${wanted}\\b`);
    if (!decl.test(signature)) continue;

    rows.push({ file, line: i + 1, name, op, wanted, text: lines[i].trim() });
  }
}

const byFile = new Map();
for (const r of rows) byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1);

console.log(`${rows.length} candidate guard(s) in ${byFile.size} file(s), by file:\n`);
for (const [file, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${file}`);
}
console.log("");
for (const r of rows) {
  console.log(`  ${r.file}:${r.line}  ${r.name} declared ${r.wanted}`);
  console.log(`      ${r.text.slice(0, 96)}`);
}
