// Exports nothing mentions: the "mechanism nothing routes through" check, as a gate.
//
// This lane has found four of these by hand -- a dead internal factory, HTTP/2
// coalescing reading an address the pooling layer never has, an `onInformational` hook
// no caller passed, and `Request.integrity` accepted and enforced nowhere. None was
// found by looking; each was found by accident, usually by a sabotage that stayed green.
//
// So the discipline is worth a tool rather than a habit. A name that is declared and
// then never mentioned again -- not by shared source, not by the public barrels, not by
// any test -- is either dead or a mechanism waiting for the caller that never came.
//
// The allowlist is the interesting part. Every entry is a decision with a reason, and a
// name that stops being unreferenced must be removed from it, so the list cannot quietly
// become a place where findings go to be forgotten.
//
// **The corpus is the whole repository, and that is the correction this tool exists in.**
// Its first version searched this lane and its tests only, called `utf8Decode` dead, and
// it was removed -- breaking thirteen modules in the Node lane, which re-exports it
// through `runtime/node/internal/utf8.ts` for `Buffer.toString("utf8")`. A check whose
// corpus is smaller than the set of possible callers does not answer "is this used"; it
// answers "is this used *here*", confidently, in the same words.
//
// Build output is excluded for the mirror reason. A stale `.d.ts` still declares what
// the source has dropped -- the Node lane's aggregate typecheck read one that was nearly
// two hours old and reported green over a broken tree -- so counting generated
// declarations as references would keep dead exports alive by their own shadows.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "runtime/web-platform/src";
/** Every place a caller could live. Add to this rather than narrowing it. */
const CORPUS = ["runtime", "tooling", "examples"];
/** Generated: it declares what source no longer has. */
const GENERATED = new Set(["node_modules", ".tsbuild", "dist", "target", "build"]);
const BARRELS = [join(SOURCE, "index.ts"), join(SOURCE, "provider.ts")];

/**
 * Names that are deliberately unreferenced, with the reason each one stays.
 *
 * A reason of the form "somebody might want it" is not a reason; if that is all there
 * is, the name should go and come back when somebody does.
 */
const ALLOWED = new Map([
  [
    "HTTP2_CONNECT_ERROR",
    "RFC 9113 error codes are declared as a complete set; a partial enumeration invites a magic number at the one site that needs the missing one.",
  ],
  ["HTTP2_HTTP_1_1_REQUIRED", "As above: the complete RFC 9113 error-code set."],
  ["HTTP2_INADEQUATE_SECURITY", "As above: the complete RFC 9113 error-code set."],
  ["HTTP2_SETTINGS_TIMEOUT", "As above: the complete RFC 9113 error-code set."],
  [
    "writableStreamDefaultWriterClose",
    "The named Streams operation. Its sibling CloseWithErrorPropagation is what pipeTo uses and the writer closes inline; keeping the operation named makes the difference between the two legible rather than folklore.",
  ],
]);

function sources(directory, extensions) {
  const out = [];
  const walk = (path) => {
    let entries;
    try {
      entries = readdirSync(path);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) {
        if (GENERATED.has(entry)) continue;
        walk(full);
        continue;
      }
      if (extensions.some((extension) => entry.endsWith(extension))) out.push(full);
    }
  };
  walk(directory);
  return out;
}

const sourceFiles = sources(SOURCE, [".ts"]);
// This file is excluded from its own corpus, and that is not a detail. The allowlist
// names the very things being searched for, so scanning it makes every allowed name
// trivially "referenced" -- a check whose corpus contains its own answer. The first
// version did exactly that and reported the allowlist as stale, which is the only
// reason it was noticed.
const SELF = join("tooling", "conformance", "web-platform", "unrouted.mjs");
const otherFiles = CORPUS.flatMap((directory) =>
  sources(directory, [".mjs", ".ts", ".js", ".mts", ".cts"]),
).filter((file) => file !== SELF && !sourceFiles.includes(file));
const text = new Map(sourceFiles.map((file) => [file, readFileSync(file, "utf8")]));
const elsewhere = otherFiles.map((file) => readFileSync(file, "utf8")).join("\n");

const declaration = /^export (?:abstract )?(?:class|interface|function|const|type|enum) (\w+)/gm;
const findings = [];
for (const [file, body] of text) {
  if (BARRELS.includes(file)) continue;
  for (const match of body.matchAll(declaration)) {
    const name = match[1];
    const word = new RegExp(`\\b${name}\\b`, "g");
    // Its own file counts: a type used as a parameter in the module that declares it is
    // part of that module's signature, not a loose end.
    const own = (body.match(word) ?? []).length;
    if (own !== 1) continue;
    let others = 0;
    for (const [candidate, content] of text) {
      if (candidate === file) continue;
      others += (content.match(word) ?? []).length;
    }
    if (others !== 0) continue;
    if ((elsewhere.match(word) ?? []).length !== 0) continue;
    findings.push({ name, file });
  }
}

const unexpected = findings.filter((finding) => !ALLOWED.has(finding.name));
const stale = [...ALLOWED.keys()].filter(
  (name) => !findings.some((finding) => finding.name === name),
);

for (const { name, file } of unexpected) {
  console.error(`unrouted: ${name} (${file}) is declared and never mentioned again`);
}
for (const name of stale) {
  console.error(`unrouted: ${name} is on the allowlist but is now referenced; remove the entry`);
}

if (unexpected.length !== 0 || stale.length !== 0) {
  console.error(
    "\nEach of these is either dead or a mechanism waiting for a caller. Wire it up," +
      " remove it, or add it to ALLOWED with the reason it stays.",
  );
  process.exit(1);
}
console.log(
  `unrouted: no unexplained exports (${findings.length} allowed, ` +
    `${text.size} audited + ${otherFiles.length} corpus files scanned)`,
);
