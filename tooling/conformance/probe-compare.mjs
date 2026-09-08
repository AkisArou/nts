// The binding comparisons, re-run rather than remembered.
//
//   node tooling/conformance/probe-compare.mjs
//   NTS_COMPILER=<pinned> node tooling/conformance/probe-compare.mjs fs-errno
//
// `binding-probe.sh` builds an addon around a few of a module's bindings without
// compiling the module, which is how bindings behind a non-compiling module get
// reached at all. What it did *not* do is keep the comparison. Each probe was
// built, compared against node by hand, and the result written into a commit
// message -- so "56 bindings compared to node" was a claim about one afternoon
// and not a check anything could re-run. A binding that regressed the next day
// would have been reported as compared and green.
//
// Two kinds of question are asked here, and the second is the one that was
// missing:
//
//   agreement   the binding answers what node answers -- errnos, constants
//   effect      the binding actually does the thing. Every error-path
//               comparison in `fs-errno` passes for a binding that returns the
//               right errno and never touches the filesystem, so `unlink` is
//               asked to remove a file that exists and the file is checked.
//
// Probes not yet ported from hand-runs: `os`, `fs`, `fs-descriptor`, `process`,
// `internal`, `zlib`. Those 43 comparisons are still one-afternoon claims. This
// file states that rather than implying its own coverage is the whole of it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, statSync, readlinkSync, rmSync, openSync, writeSync, closeSync, unlinkSync } from "node:fs";
import { constants as C, mkdtempSync as nodeMkdtemp } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

// A harness that has never been observed to fail is a claim. `--self-test` adds
// one check that expects the wrong answer from a real binding -- built, loaded
// and called the same way as every other -- and then asserts that exactly that
// one is reported. It exercises the whole path rather than the comparison
// operator, which is the part that could not plausibly break.
const SELF_TEST = process.argv.includes("--self-test");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const require = createRequire(import.meta.url);

/** Build a probe addon and load it. Returns null if the build failed. */
function buildProbe(module, probeFile) {
  let out;
  try {
    out = execFileSync("bash", [join(HERE, "binding-probe.sh"), module, join(HERE, "probes", probeFile)],
      { encoding: "utf8", cwd: ROOT, maxBuffer: 64 * 1024 * 1024, timeout: 900_000 });
  } catch (e) {
    return { error: (e.stdout ?? "") + (e.stderr ?? "") };
  }
  const m = /(\S+\.node)\s*$/.exec(out.trim());
  if (m === null) return { error: out };
  return { addon: require(m[1]) };
}

const PROBES = [
  {
    file: "fs-constants.ts",
    module: "fs",
    // Weak by construction and recorded as such: these are written
    // `(double)O_EXCL`, so they are right on any platform whose headers are.
    // Kept because the day one is transcribed as a literal, this notices.
    checks(m) {
      const out = [];
      const pairs = [["probeAppend", "O_APPEND"], ["probeCreat", "O_CREAT"], ["probeDirect", "O_DIRECT"],
        ["probeDirectory", "O_DIRECTORY"], ["probeDsync", "O_DSYNC"], ["probeExcl", "O_EXCL"],
        ["probeNoatime", "O_NOATIME"], ["probeNoctty", "O_NOCTTY"], ["probeNofollow", "O_NOFOLLOW"],
        ["probeNonblock", "O_NONBLOCK"], ["probeSync", "O_SYNC"], ["probeTrunc", "O_TRUNC"]];
      for (const [fn, name] of pairs) out.push({ label: name, mine: m[fn](), theirs: C[name] });
      out.push({ label: "is_32_bit", mine: m.probeIs32Bit(), theirs: process.arch.includes("32") || process.arch === "ia32" || process.arch === "arm" });
      if (SELF_TEST) {
        out.push({ label: "SELF-TEST O_EXCL+1", mine: m.probeExcl(), theirs: C.O_EXCL + 1 });
      }
      return out;
    },
  },
  {
    file: "fs-errno.ts",
    module: "fs",
    checks(m) {
      const out = [];
      const nx = "/nonexistent-nts-probe/xyz";
      const errnoOf = (thunk) => { try { thunk(); return 0; } catch (e) { return e.errno; } };
      const fsm = require("node:fs");
      // Agreement: the libuv errno each binding returns on its failure path.
      out.push({ label: "unlink ENOENT", mine: m.probeUnlink(nx), theirs: errnoOf(() => fsm.unlinkSync(nx)) });
      out.push({ label: "rename ENOENT", mine: m.probeRename(nx, nx + "2"), theirs: errnoOf(() => fsm.renameSync(nx, nx + "2")) });
      out.push({ label: "copyfile ENOENT", mine: m.probeCopyfile(nx, nx + "2", 0), theirs: errnoOf(() => fsm.copyFileSync(nx, nx + "2", 0)) });
      out.push({ label: "chown ENOENT", mine: m.probeChown(nx, -1, -1), theirs: errnoOf(() => fsm.chownSync(nx, -1, -1)) });
      out.push({ label: "utimes ENOENT", mine: m.probeUtimes(nx, 0, 0), theirs: errnoOf(() => fsm.utimesSync(nx, 0, 0)) });
      out.push({ label: "link ENOENT", mine: m.probeLink(nx, nx + "2"), theirs: errnoOf(() => fsm.linkSync(nx, nx + "2")) });
      out.push({ label: "ftruncate EBADF", mine: m.probeFtruncate(9999, 0), theirs: errnoOf(() => fsm.ftruncateSync(9999, 0)) });

      // Effect: the half the error paths cannot see. A binding that answers the
      // right errno and never performs the operation passes every check above.
      const dir = mkdtempSync(join(tmpdir(), "nts-probe-"));
      const p = (n) => join(dir, n);
      try {
        writeFileSync(p("u"), "x");
        out.push({ label: "unlink removes", mine: m.probeUnlink(p("u")) === 0 && !existsSync(p("u")), theirs: true });
        writeFileSync(p("r1"), "y");
        out.push({ label: "rename moves", mine: m.probeRename(p("r1"), p("r2")) === 0 && !existsSync(p("r1")) && readFileSync(p("r2"), "utf8") === "y", theirs: true });
        out.push({ label: "copyfile copies", mine: m.probeCopyfile(p("r2"), p("c1"), 0) === 0 && readFileSync(p("c1"), "utf8") === "y", theirs: true });
        out.push({ label: "link shares inode", mine: m.probeLink(p("c1"), p("l1")) === 0 && statSync(p("c1")).ino === statSync(p("l1")).ino, theirs: true });
        out.push({ label: "symlink target", mine: m.probeSymlink("target-x", p("s1"), 0) === 0 && readlinkSync(p("s1")) === "target-x", theirs: true });
        out.push({ label: "utimes sets mtime", mine: m.probeUtimes(p("c1"), 1000, 2000) === 0 && Math.round(statSync(p("c1")).mtimeMs / 1000) === 2000, theirs: true });
        const fd = openSync(p("t1"), "w"); writeSync(fd, "abcdefghij");
        const rt = m.probeFtruncate(fd, 4); closeSync(fd);
        out.push({ label: "ftruncate shortens", mine: rt === 0 && readFileSync(p("t1"), "utf8") === "abcd", theirs: true });
        // mkdtemp: shape rather than value -- the suffix is random by design, so
        // what is checkable is that the template was consumed and the directory
        // exists with node's suffix length.
        const mine = m.probeMkdtemp(join(dir, "tmpXXXXXX"));
        const theirs = nodeMkdtemp(join(dir, "tmp"));
        out.push({
          label: "mkdtemp shape",
          mine: typeof mine === "string" && !mine.includes("XXXXXX") && existsSync(mine) && basename(mine).length === basename(theirs).length,
          theirs: true,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return out;
    },
  },
];

const only = process.argv.slice(2).find((a) => !a.startsWith("-"));
let total = 0, diverged = 0, built = 0;
for (const probe of PROBES) {
  if (only !== undefined && !probe.file.startsWith(only)) continue;
  process.stdout.write(`  ${probe.file} ... `);
  const result = buildProbe(probe.module, probe.file);
  if (result.error !== undefined) {
    console.log("DID NOT BUILD");
    console.log(result.error.split("\n").filter((l) => /error/i.test(l)).slice(0, 3).map((l) => `      ${l}`).join("\n"));
    diverged++;
    continue;
  }
  built++;
  let checks;
  try {
    checks = probe.checks(result.addon);
  } catch (e) {
    console.log(`THREW: ${e.message}`);
    diverged++;
    continue;
  }
  const bad = checks.filter((c) => c.mine !== c.theirs);
  total += checks.length;
  diverged += bad.length;
  console.log(`${checks.length} check(s), ${bad.length} divergence(s)`);
  for (const c of bad) console.log(`      DIFF  ${c.label}: mine=${c.mine} node=${c.theirs}`);
}

console.log(`\n  ${built} probe(s) built, ${total} comparison(s), ${diverged} divergence(s)`);

if (SELF_TEST) {
  // Exactly one divergence, and it has to be the injected one. Zero means the
  // harness cannot see a wrong answer and every green run above meant nothing;
  // more than one means something else is genuinely broken and the control
  // cannot speak to the harness either way.
  const ok = diverged === 1;
  console.log(ok
    ? "  self-test: the injected wrong answer was reported, so a real one would be"
    : `  SELF-TEST FAILED: expected exactly 1 divergence, saw ${diverged}`);
  process.exitCode = ok ? 0 : 1;
} else {
  process.exitCode = diverged > 0 ? 1 : 0;
}
