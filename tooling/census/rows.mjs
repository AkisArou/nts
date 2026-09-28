// Ask a census's rows a question: which files, grouped how, and what moved.
//
//   node tooling/census/rows.mjs <rows> [<rows> ...] [filters] [--by <key>] [--list N]
//   node tooling/census/rows.mjs --diff <before-rows> <after-rows> [filters]
//   node tooling/census/rows.mjs --self-test
//
// filters (all must hold; each takes a regular expression):
//   --bucket <re>     the file's bucket: strict-pass, threw, unsupported, invalid-hir, ...
//   --why <re>        why it is unsupported: lowering, typescript, backend, ...
//   --message <re>    any diagnostic's message (numbering already taken out: `X`)
//   --code <re>       any diagnostic's code: NTS1001, TS2322, ...
//   --where <re>      where that diagnostic is: body or harness (with --message/--code)
//   --first <re>      the first line the file failed with (invalid HIR's verifier text)
//   --path <re>       the test's path
//   --source <re>     the test's own source, front matter removed -- what it *contains*
//
// --by: bucket (default), why, dir (the path without the file), construct
// (a dstr/ file's prefix: `gen-meth-static-`...), message (the first NTS1001),
// first, code.
//
// # Why
//
// A full census is 29,586 files and the rows keep every diagnostic, so a
// prediction about where a family lives is a query, not a run. On 2026-09-27
// "test262's harness hits `an erased value where a concrete representation is
// wanted` constantly" took four full runs to refute -- 7 files, none through
// the harness -- and the 263 invalid-HIR files were taken apart by crossing
// paths with pattern cases and grepping the tests' sources, each by a one-off
// `node -e`. Those are this tool's filters.
//
// A row is a *file*: a refused file is `unsupported` with `why: lowering`, and
// its messages are in `diagnostics`. The totals a run prints count variants,
// which are more than the files.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bodyOf } from "./project.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** The rows of one `--rows` file, keyed by path; the header line is not a row. */
export function readRows(text) {
  const rows = new Map();
  for (const line of text.split("\n")) {
    if (!line.startsWith('{"path"')) continue;
    const r = JSON.parse(line);
    rows.set(r.path, r);
  }
  return rows;
}

/** The dstr/ construct a file belongs to: the prefix before its pattern case. */
export function construct(path) {
  const parts = path.split("/");
  const file = parts.at(-1).replace(/\.js$/, "");
  const at = file.search(/(ary|obj)-(init|ptrn|name)/);
  return `${parts.slice(2, -1).join("/")}:${at > 0 ? file.slice(0, at - 1) : "-"}`;
}

const KEYS = {
  bucket: (r) => r.bucket,
  why: (r) => r.why ?? "-",
  dir: (r) => r.path.split("/").slice(0, -1).join("/"),
  construct: (r) => construct(r.path),
  message: (r) => (r.diagnostics ?? []).find((d) => d.code === "NTS1001")?.message ?? r.first ?? "-",
  first: (r) => r.first ?? "-",
  code: (r) => (r.diagnostics ?? [])[0]?.code ?? "-",
};

/** A predicate over rows from the command line's filters. */
export function filterFrom(opts, source = (path) => bodyOf(readFileSync(join(ROOT, "third_party/test262", path), "utf8"))) {
  const re = (name) => (opts[name] === undefined ? null : new RegExp(opts[name]));
  const [bucket, why, message, code, where, first, path, src] = ["bucket", "why", "message", "code", "where", "first", "path", "source"].map(re);
  return (r) => {
    if (bucket && !bucket.test(r.bucket)) return false;
    if (why && !why.test(r.why ?? "")) return false;
    if (first && !first.test(r.first ?? "")) return false;
    if (path && !path.test(r.path)) return false;
    if (message || code) {
      const hit = (r.diagnostics ?? []).some((d) => (!message || message.test(d.message)) && (!code || code.test(d.code)) && (!where || where.test(d.where ?? "")));
      if (!hit) return false;
    }
    if (src) {
      let text;
      try { text = source(r.path); } catch { return false; }
      if (!src.test(text)) return false;
    }
    return true;
  };
}

/** Rows grouped by `key`, largest group first, each with an example path. */
export function group(rows, key) {
  const out = new Map();
  for (const r of rows) {
    const k = KEYS[key](r);
    const g = out.get(k) ?? { n: 0, example: r.path };
    g.n += 1;
    out.set(k, g);
  }
  return [...out].sort((a, b) => b[1].n - a[1].n);
}

/** Every file whose bucket or cause moved between two runs, grouped by the move. */
export function diff(before, after) {
  const cause = (r) => (r ? `${r.bucket}${r.why ? `/${r.why}` : ""}: ${KEYS.message(r)}` : "(not in run)");
  const moves = new Map();
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path);
    const b = after.get(path);
    const bucketMoved = (a?.bucket ?? null) !== (b?.bucket ?? null);
    const causeMoved = !bucketMoved && cause(a) !== cause(b);
    if (!bucketMoved && !causeMoved) continue;
    const k = bucketMoved ? `${a?.bucket ?? "(not in run)"} -> ${b?.bucket ?? "(not in run)"}` : `cause, within ${a.bucket}: ${cause(a).slice(0, 90)}  ->  ${cause(b).slice(0, 90)}`;
    moves.set(k, [...(moves.get(k) ?? []), path]);
  }
  return [...moves].sort((a, b) => b[1].length - a[1].length);
}

// **Seen to answer before it is trusted.**
function selfTest() {
  const text = [
    '{"fingerprint":"x","under":"test/language"}',
    '{"path":"test/language/expressions/class/dstr/gen-meth-static-ary-ptrn-empty.js","bucket":"invalid-hir","first":"FellThrough { func: \\"X\\", block: BlockId(N) }"}',
    '{"path":"test/built-ins/Date/a.js","bucket":"unsupported","why":"lowering","diagnostics":[{"code":"NTS1001","message":"an erased value where a concrete representation is wanted","where":"body"}]}',
    '{"path":"test/built-ins/Date/b.js","bucket":"strict-pass"}',
  ].join("\n");
  const rows = readRows(text);
  if (rows.size !== 3) return `${rows.size} rows read from three and a header`;
  if (construct("test/language/expressions/class/dstr/gen-meth-static-ary-ptrn-empty.js") !== "expressions/class/dstr:gen-meth-static") return "a dstr construct";
  const sources = { "test/built-ins/Date/b.js": "var g = function* () {};" };
  const pick = (opts) => [...rows.values()].filter(filterFrom(opts, (p) => sources[p] ?? "")).map((r) => r.path.split("/").at(-1));
  if (pick({ message: "erased value", where: "body" }).join() !== "a.js") return "a message filter";
  if (pick({ message: "erased value", where: "harness" }).length !== 0) return "a message filter scoped to the harness";
  if (pick({ source: "function\\s*\\*" }).join() !== "b.js") return "a source filter";
  if (group([...rows.values()], "bucket")[0][1].n !== 1 || group([...rows.values()], "bucket").length !== 3) return "grouping by bucket";
  const after = readRows(text.replace('"bucket":"strict-pass"', '"bucket":"threw"').replace("an erased value", "a different cause"));
  const moves = diff(rows, after).map(([k, v]) => `${k.split(":")[0]}=${v.length}`).sort().join(" ");
  if (moves !== "cause, within unsupported=1 strict-pass -> threw=1") return `the diff read ${moves}`;
  return null;
}

// Importable for its functions (readRows, filterFrom, group, diff); runs only as a command.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const broken = selfTest();
  if (broken) {
    console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
    process.exit(2);
  }
  if (argv.includes("--self-test")) {
    console.log("  self-test: rows, constructs, message/where/source filters, grouping and a bucket and a cause move each read");
    process.exit(0);
  }

  const FLAGS = ["bucket", "why", "message", "code", "where", "first", "path", "source", "by", "list"];
  const opts = {};
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, "");
    if (argv[i].startsWith("--") && FLAGS.includes(name)) opts[name] = argv[++i];
    else if (argv[i] !== "--diff") files.push(argv[i]);
  }
  if (files.length === 0 || (opts.by && !KEYS[opts.by])) {
    console.log(`  usage: rows.mjs <rows> ... [--${FLAGS.slice(0, 8).join(" <re>] [--")} <re>] [--by ${Object.keys(KEYS).join("|")}] [--list N]`);
    console.log("         rows.mjs --diff <before-rows> <after-rows> [filters]");
    process.exit(2);
  }
  const keep = filterFrom(opts);

  if (argv.includes("--diff")) {
    if (files.length !== 2) {
      console.log("  --diff takes two rows files, before then after");
      process.exit(2);
    }
    const [before, after] = files.map((f) => readRows(readFileSync(f, "utf8")));
    const scope = (m) => new Map([...m].filter(([, r]) => keep(r)));
    const moves = diff(scope(before), scope(after));
    console.log(`  before ${before.size} file(s), after ${after.size}; ${moves.reduce((a, [, v]) => a + v.length, 0)} moved`);
    for (const [k, paths] of moves) {
      console.log(`  ${String(paths.length).padStart(5)}  ${k}`);
      for (const p of paths.slice(0, Number(opts.list ?? 5))) console.log(`           ${p}`);
    }
    if (moves.length === 0) console.log("  no file moved, and no file's cause changed");
    process.exit(0);
  }

  const rows = files.flatMap((f) => [...readRows(readFileSync(f, "utf8")).values()]);
  const matched = rows.filter(keep);
  console.log(`  ${matched.length} of ${rows.length} file(s) match`);
  for (const [k, g] of group(matched, opts.by ?? "bucket").slice(0, Number(opts.list ?? 20))) {
    console.log(`  ${String(g.n).padStart(6)}  ${String(k).slice(0, 110)}   e.g. ${g.example}`);
  }
}
