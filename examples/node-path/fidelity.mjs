// Does the port compute what `node:path` computes?
//
// `nts check` compares the compiled program against node running this same
// source, which proves the *compiler* faithful and says nothing about the
// *port*. A transcription that dropped a branch would agree with itself
// perfectly. So this runs the port and node's own `path.posix` on the same
// engine over a corpus of awkward paths, and compares.
//
// It is the gate that decides whether "we compiled node's path" is a true
// sentence, and it costs one script.

import { posix as real } from "node:path";

// `resolve` calls the declared `nts_process_cwd`. Compiled, that is an extern
// satisfied by uv_cwd; on node it is this global. Same function either way.
globalThis.nts_process_cwd = () => process.cwd();
import {
  normalize,
  isAbsolute,
  dirname,
  basename,
  extname,
  join,
  resolve,
} from "./src/main.ts";

// Paths chosen for the places a path implementation goes wrong: empty, bare
// separators, runs of separators, `.` and `..` at every position including
// above the root, trailing separators, dotfiles, multiple extensions, and a
// name that is exactly dots.
const PATHS = [
  "", ".", "..", "...", "/", "//", "///", "/.", "/..", "./", "../",
  "a", "/a", "a/", "/a/", "a/b", "/a/b", "a/b/", "/a/b/",
  "a//b", "a///b", "//a//b//",
  "a/./b", "a/../b", "./a/b", "../a/b", "a/b/..", "a/b/.",
  "/../a", "/../../a", "../../a", "a/../../b", "a/b/../../c",
  ".hidden", "/.hidden", "a/.hidden", ".hidden.txt",
  "a.txt", "/a/b/c.txt", "a.tar.gz", "a.", "a..", ".a.", "..a",
  "file.", "/dir.ext/file", "/dir.ext/file.txt",
  "  ", "a b/c d", "héllo/wörld", "a\u{1F600}b/c",
];

let checked = 0;
const failures = [];

function compare(name, mine, theirs, ...args) {
  checked++;
  const a = mine(...args);
  const b = theirs(...args);
  if (!Object.is(a, b)) {
    failures.push(
      `${name}(${args.map((x) => JSON.stringify(x)).join(", ")})\n` +
        `  port ${JSON.stringify(a)}\n  node ${JSON.stringify(b)}`,
    );
  }
}

for (const p of PATHS) {
  compare("normalize", normalize, real.normalize, p);
  compare("isAbsolute", isAbsolute, real.isAbsolute, p);
  compare("dirname", dirname, real.dirname, p);
  compare("basename", basename, real.basename, p);
  compare("extname", extname, real.extname, p);
  for (const q of PATHS) {
    compare("join", join, real.join, p, q);
    compare("resolve", resolve, real.resolve, p, q);
  }
}

console.log(`${checked} cases against node:path.posix`);
if (failures.length === 0) {
  console.log("agreed on every case");
} else {
  console.log(`${failures.length} disagreement(s):`);
  for (const f of failures.slice(0, 25)) console.log(f);
  process.exitCode = 1;
}
