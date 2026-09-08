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
  {
    file: "os.ts",
    module: "os",
    checks(m) {
      const os = require("node:os");
      return [
        { label: "hostname", mine: m.hostname(), theirs: os.hostname() },
        { label: "tmpdir", mine: m.tmpdir(), theirs: os.tmpdir() },
      ];
    },
  },
  {
    file: "process.ts",
    module: "process",
    checks(m) {
      const out = [
        { label: "argv0", mine: m.probeArgv0(), theirs: process.argv0 },
        { label: "cwd", mine: m.probeCwd(), theirs: process.cwd() },
        { label: "execPath", mine: m.probeExecPath(), theirs: process.execPath },
        { label: "env PATH", mine: m.probeEnv("PATH"), theirs: process.env.PATH },
        { label: "env has PATH", mine: m.probeEnvHas("PATH"), theirs: true },
        { label: "env absent", mine: m.probeEnvHas("NTS_DEFINITELY_UNSET_XYZ"), theirs: false },
        { label: "getuid", mine: m.probeGetuid(), theirs: process.getuid() },
        { label: "getgid", mine: m.probeGetgid(), theirs: process.getgid() },
        { label: "geteuid", mine: m.probeGeteuid(), theirs: process.geteuid() },
        { label: "getegid", mine: m.probeGetegid(), theirs: process.getegid() },
      ];
      // Memory figures move between the two calls, so the comparable thing is
      // the order of magnitude rather than the number. Anything else would be a
      // check that fails for a reason other than a defect.
      const av = m.probeAvailableMemory(), nav = process.availableMemory();
      out.push({ label: "availableMemory within 4x", mine: av > 0 && av < nav * 4 && av > nav / 4, theirs: true });
      const cm = m.probeConstrainedMemory();
      out.push({ label: "constrainedMemory >= 0", mine: cm >= 0, theirs: true });
      const up = m.probeUptimeShape();
      out.push({ label: "uptime is a number", mine: up, theirs: typeof process.uptime() });
      return out;
    },
  },
  {
    file: "zlib.ts",
    module: "zlib",
    checks(m) {
      const zlib = require("node:zlib");
      const out = [];
      // The one that found a real defect: this binding was declared to take a
      // Uint8Array and implemented against NtsArray.
      for (const text of ["", "a", "hello", "the quick brown fox", "\u00ff\u00fe"]) {
        out.push({
          label: `crc32 ${JSON.stringify(text)}`,
          mine: m.probeCrc32(text, 0),
          // `probes/zlib.ts` builds its Uint8Array with `charCodeAt(i) & 0xff`,
          // so the bytes that cross are latin1 by construction. Comparing
          // against UTF-8 here reported a divergence on the one input where the
          // two encodings differ, and the binding was right both times.
          theirs: zlib.crc32(Buffer.from(text, "latin1"), 0),
        });
      }
      out.push({ label: "crc32 with initial", mine: m.probeCrc32("abc", 12345), theirs: zlib.crc32(Buffer.from("abc"), 12345) });
      // Which byte sequence does a probe that takes a *string* actually hash?
      // "\u00ff\u00fe" is two bytes in latin1 and four in UTF-8, and the two
      // give different CRCs -- so this says which encoding crossed the boundary
      // rather than only that something disagreed.
      const hi = "\u00ff\u00fe";
      out.push({
        label: "crc32 high bytes is utf-8",
        mine: m.probeCrc32(hi, 0),
        theirs: zlib.crc32(Buffer.from(hi, "latin1"), 0),
        detail: `utf-8 would be ${zlib.crc32(Buffer.from(hi, "utf8"), 0)}`,
      });
      out.push({ label: "vernum > 0", mine: m.probeVernum() > 0, theirs: true });
      out.push({ label: "lastStatus is Z_OK", mine: m.probeLastStatus(), theirs: 0 });
      out.push({ label: "lastErrorCode empty", mine: m.probeLastErrorCode(), theirs: "" });
      return out;
    },
  },
  {
    file: "internal.ts",
    module: "internal",
    checks(m) {
      const os = require("node:os");
      const out = [
        { label: "platform", mine: m.probePlatform(), theirs: process.platform },
        { label: "pid", mine: m.probePid(), theirs: process.pid },
        { label: "eol", mine: m.probeEol(), theirs: os.EOL },
        { label: "stdout isTTY", mine: m.probeStdoutTty(), theirs: process.stdout.isTTY === true },
        { label: "stderr isTTY", mine: m.probeStderrTty(), theirs: process.stderr.isTTY === true },
      ];
      // uv error names, against the codes node itself reports through fs.
      const fsm = require("node:fs");
      const codeOf = (thunk) => { try { thunk(); return null; } catch (e) { return e; } };
      const enoent = codeOf(() => fsm.statSync("/nonexistent-nts-probe/xyz"));
      out.push({ label: "err name ENOENT", mine: m.probeErrName(enoent.errno), theirs: enoent.code });
      const ebadf = codeOf(() => fsm.fstatSync(9999));
      out.push({ label: "err name EBADF", mine: m.probeErrName(ebadf.errno), theirs: ebadf.code });
      out.push({ label: "err message ENOENT", mine: m.probeErrMessage(enoent.errno).length > 0, theirs: true });
      out.push({ label: "release non-empty", mine: m.probeRelease().length > 0, theirs: true });
      out.push({ label: "argv length >= 1", mine: m.probeArgvLength() >= 1, theirs: true });
      out.push({ label: "argv0 non-empty", mine: m.probeArgv0().length > 0, theirs: true });
      out.push({ label: "signal count > 0", mine: m.probeSignalCount() > 0, theirs: true });
      // 128 + signal number is node's exit code for a fatal signal.
      out.push({ label: "SIGINT exit code", mine: m.probeSignalExitCode("SIGINT"), theirs: 128 + 2 });
      out.push({ label: "SIGTERM exit code", mine: m.probeSignalExitCode("SIGTERM"), theirs: 128 + 15 });
      const uuid = m.probeUuidShape();
      // `length:versionNibble`, derived from node's own generator rather than
      // written down, so the day node changes shape this follows.
      const nodeUuid = require("node:crypto").randomUUID();
      out.push({ label: "uuid length:version", mine: uuid, theirs: `${nodeUuid.length}:${nodeUuid[14]}` });
      return out;
    },
  },
  {
    file: "fs.ts",
    module: "fs",
    checks(m) {
      const fsm = require("node:fs");
      const errnoOf = (thunk) => { try { thunk(); return 0; } catch (e) { return e.errno; } };
      const nx = "/nonexistent-nts-probe/xyz";
      const out = [
        { label: "access ENOENT", mine: m.probeAccess(nx, 0), theirs: errnoOf(() => fsm.accessSync(nx, 0)) },
        { label: "chmod ENOENT", mine: m.probeChmod(nx, 0o644), theirs: errnoOf(() => fsm.chmodSync(nx, 0o644)) },
        { label: "rmdir ENOENT", mine: m.probeRmdir(nx), theirs: errnoOf(() => fsm.rmdirSync(nx)) },
        { label: "EISDIR constant", mine: m.probeEisdir(), theirs: errnoOf(() => fsm.readFileSync("/")) },
      ];
      const dir = mkdtempSync(join(tmpdir(), "nts-probe-"));
      const p2 = (n) => join(dir, n);
      try {
        out.push({ label: "access on a real file", mine: (writeFileSync(p2("a"), "x"), m.probeAccess(p2("a"), 0)), theirs: 0 });
        out.push({ label: "mkdir creates", mine: m.probeMkdir(p2("d"), 0o755) === 0 && statSync(p2("d")).isDirectory(), theirs: true });
        out.push({ label: "rmdir removes", mine: m.probeRmdir(p2("d")) === 0 && !existsSync(p2("d")), theirs: true });
        out.push({ label: "chmod sets mode", mine: m.probeChmod(p2("a"), 0o600) === 0 && (statSync(p2("a")).mode & 0o777) === 0o600, theirs: true });
        require("node:fs").symlinkSync("some-target", p2("s"));
        out.push({ label: "readlink", mine: m.probeReadlink(p2("s")), theirs: readlinkSync(p2("s")) });
        out.push({ label: "realpath", mine: m.probeRealpath(p2("a")), theirs: require("node:fs").realpathSync(p2("a")) });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      out.push({ label: "mkdtemp warns", mine: m.probeWarnsOnMkdtemp(), theirs: false });
      return out;
    },
  },
  {
    file: "fs-descriptor.ts",
    module: "fs",
    checks(m) {
      const fsm = require("node:fs");
      const errnoOf = (thunk) => { try { thunk(); return 0; } catch (e) { return e.errno; } };
      const out = [
        { label: "close EBADF", mine: m.probeCloseBad(9999), theirs: errnoOf(() => fsm.closeSync(9999)) },
        { label: "fsync EBADF", mine: m.probeFsyncBad(9999), theirs: errnoOf(() => fsm.fsyncSync(9999)) },
      ];
      const dir = mkdtempSync(join(tmpdir(), "nts-probe-"));
      const f = join(dir, "a");
      try {
        writeFileSync(f, "0123456789");
        out.push({ label: "open/close succeeds", mine: m.probeOpenClose(f, 0), theirs: 0 });
        out.push({ label: "fsync succeeds", mine: m.probeFsync(f, 0), theirs: 0 });
        out.push({ label: "fdatasync succeeds", mine: m.probeFdatasync(f, 0), theirs: 0 });
        // The shape string carries size; node knows the same file.
        const shape = m.probeFstatShape(f, 0);
        // The probe answers `columns.length`. Node's own Stats carries exactly
        // these fourteen numeric fields, so the expected count is derived from
        // node rather than asserted -- checking for the file's size in that
        // string was simply the wrong question about the wrong value.
        const numeric = ["dev", "mode", "nlink", "uid", "gid", "rdev", "blksize",
          "ino", "size", "blocks", "atimeMs", "mtimeMs", "ctimeMs", "birthtimeMs"];
        const st = fsm.statSync(f);
        out.push({
          label: "fstat column count",
          mine: Number(shape),
          theirs: numeric.filter((k) => typeof st[k] === "number").length,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return out;
    },
  },
  {
    file: "os-full.ts",
    module: "os",
    checks(m) {
      const os = require("node:os");
      const info = os.userInfo();
      const out = [
        { label: "homedir", mine: m.probeHomedir(), theirs: os.homedir() },
        { label: "totalmem", mine: m.probeTotalmem(), theirs: os.totalmem() },
        { label: "availableParallelism", mine: m.probeParallelism(), theirs: os.availableParallelism() },
        { label: "getPriority(0)", mine: m.probeGetPriority(0), theirs: os.getPriority(0) },
        { label: "userInfo uid", mine: m.probeUserUid(), theirs: info.uid },
        { label: "userInfo gid", mine: m.probeUserGid(), theirs: info.gid },
        { label: "username first byte", mine: m.probeUsernameFirstByte(), theirs: info.username.charCodeAt(0) },
        { label: "loadavg length", mine: m.probeLoadavgShape(), theirs: `${os.loadavg().length}:true:true:true` },
        { label: "loadavg[0]", mine: m.probeLoadavgFirst(), theirs: os.loadavg()[0] },
        // The binding's column order, not node's documented one -- type,
        // version, release, machine, arch, platform, endianness.
        {
          label: "static information",
          mine: m.probeStaticJoined(),
          theirs: [os.type(), os.version(), os.release(), os.machine(), os.arch(), os.platform(), os.endianness()].join("|"),
        },
      ];
      // Two figures that move between the two calls, so magnitude is what is
      // comparable and a tighter check would fail for a reason that is not a
      // defect.
      const up = m.probeUptime(), nup = os.uptime();
      out.push({ label: "uptime within 5s", mine: Math.abs(up - nup) < 5, theirs: true, detail: `${up} vs ${nup}` });
      const free = m.probeFreemem(), nfree = os.freemem();
      out.push({ label: "freemem within 10%", mine: Math.abs(free - nfree) < nfree * 0.1, theirs: true, detail: `${free} vs ${nfree}` });
      out.push({ label: "udp reuseaddr > 0", mine: m.probeUdpReuseaddr() > 0, theirs: true });
      return out;
    },
  },
  {
    file: "zlib-oneshot.ts",
    module: "zlib",
    // The strongest comparison in the tree: not "does this binding answer the
    // same number", but "does this compressor emit the same bytes". zlib's own
    // tests round-trip through one implementation, so a compressor that is
    // self-consistently wrong passes all of them.
    checks(m) {
      const zlib = require("node:zlib");
      const out = [];
      const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));
      const texts = ["", "a", "hello world",
        "the quick brown fox jumps over the lazy dog".repeat(10), "\u00ff\u00fe "];
      for (const text of texts) {
        const buf = Buffer.from(text, "latin1");
        const tag = JSON.stringify(text.length > 16 ? text.slice(0, 10) + "..." : text);
        for (const level of [1, 6, 9]) {
          out.push({
            label: `deflate L${level} ${tag}`,
            mine: eq(m.probeDeflate(text, level), zlib.deflateSync(buf, { level })),
            theirs: true,
          });
        }
        out.push({
          label: `deflateRaw L6 ${tag}`,
          mine: eq(m.probeDeflateRaw(text, 6), zlib.deflateRawSync(buf, { level: 6 })),
          theirs: true,
        });
        out.push({ label: `roundtrip ${tag}`, mine: eq(m.probeInflateOfDeflate(text, 6), buf), theirs: true });
      }
      // Levels have to actually differ, or every row above passes for a build
      // that ignores the parameter and always deflates at one setting.
      const long = "the quick brown fox jumps over the lazy dog".repeat(10);
      out.push({
        label: "level is honoured",
        mine: Buffer.from(m.probeDeflate(long, 1)).length !== Buffer.from(m.probeDeflate(long, 6)).length,
        theirs: true,
      });
      out.push({ label: "status clean", mine: m.probeLastStatus(), theirs: 0 });
      out.push({ label: "error code empty", mine: m.probeLastErrorCode(), theirs: "" });
      return out;
    },
  },
  {
    file: "process-full.ts",
    module: "process",
    checks(m) {
      const out = [
        { label: "arch", mine: m.probeArch(), theirs: process.arch },
        { label: "version", mine: m.probeVersion(), theirs: process.version },
        { label: "ppid", mine: m.probePpid(), theirs: process.ppid },
        { label: "title", mine: m.probeTitle(), theirs: process.title },
        { label: "env key count", mine: m.probeEnvKeyCount(), theirs: Object.keys(process.env).length },
        { label: "env has PATH", mine: m.probeEnvHasKey("PATH"), theirs: true },
        { label: "env has nonsense", mine: m.probeEnvHasKey("NTS_UNSET_XYZ"), theirs: false },
        { label: "group count", mine: m.probeGroupCount(), theirs: process.getgroups().length },
        // Node's order is not `id -G`'s order, and this binding matches node's.
        { label: "first group", mine: m.probeFirstGroup(), theirs: process.getgroups()[0] },
        { label: "argv count", mine: m.probeArgvCount(), theirs: process.argv.length },
        { label: "argv[0]", mine: m.probeArgvFirst(), theirs: process.argv[0] },
        { label: "execArgv count", mine: m.probeExecArgvCount(), theirs: process.execArgv.length },
        { label: "version table aligned", mine: m.probeVersionTableAligned(), theirs: true },
      ];
      // The whole `process.versions` table, name by name. A count would pass for
      // a table whose columns had shifted by one.
      out.push({
        label: "versions table",
        mine: m.probeVersionsJoined(),
        theirs: Object.entries(process.versions).map(([k, v]) => `${k}=${v};`).join(""),
      });
      out.push({ label: "umask is plausible", mine: m.probeUmaskRead() >= 0 && m.probeUmaskRead() <= 0o777, theirs: true });
      return out;
    },
  },
  {
    file: "fs-blind.ts",
    module: "fs",
    // The ten `fs` bindings `standin-blindspot.mjs` named: each has a stand-in
    // that calls node's own implementation, and `fs` does not compile, so until
    // this file nothing in the tree could report them wrong.
    checks(m) {
      const fsm = require("node:fs");
      const osm = require("node:os");
      const pathm = require("node:path");
      const dir = mkdtempSync(join(tmpdir(), "nts-blind-"));
      const f = join(dir, "a");
      const out = [];
      try {
        writeFileSync(f, "0123456789");
        const link = join(dir, "l");
        fsm.symlinkSync("a", link);
        const st = statSync(f);
        const numeric = ["dev", "mode", "nlink", "uid", "gid", "rdev", "blksize",
          "ino", "size", "blocks", "atimeMs", "mtimeMs", "ctimeMs", "birthtimeMs"];
        out.push({ label: "stat column count", mine: m.probeStatCount(f), theirs: numeric.length });
        out.push({ label: "stat size column", mine: m.probeStatSize(f), theirs: st.size });
        out.push({ label: "stat bigint count", mine: m.probeStatBigIntCount(f), theirs: numeric.length });
        out.push({ label: "stat bigint size", mine: m.probeStatBigIntSize(f), theirs: String(fsm.statSync(f, { bigint: true }).size) });
        out.push({ label: "stat follows symlink", mine: m.probeStatSize(link), theirs: st.size });
        out.push({ label: "read utf8 by fd", mine: m.probeReadUtf8(f), theirs: readFileSync(f, "utf8") });
        // The return is an errno, not a byte count -- `main.ts:899` is
        // `check(result, "write")`. Expecting the length reported a divergence
        // for a binding that had written the file correctly, which the next row
        // proves.
        const w = join(dir, "w");
        out.push({ label: "write utf8 by fd", mine: m.probeWriteUtf8(w, "written by nts"), theirs: 0 });
        out.push({ label: "write landed", mine: readFileSync(w, "utf8"), theirs: "written by nts" });
        out.push({
          label: "read bytes by fd",
          mine: m.probeReadBytes(f, 10),
          theirs: [...readFileSync(f)].map((b) => `${b},`).join(""),
        });
        out.push({ label: "access_bytes ok", mine: m.probeAccessBytes(f, 0), theirs: 0 });
        const nope = join(dir, "nope");
        let enoent = 0;
        try { fsm.accessSync(nope, 0); } catch (e) { enoent = e.errno; }
        out.push({ label: "access_bytes ENOENT", mine: m.probeAccessBytes(nope, 0), theirs: enoent });
        out.push({ label: "realpath_bytes", mine: m.probeRealpathBytes(link), theirs: fsm.realpathSync(link) });
        // A symlink created through the byte path and read back through the
        // string one, so a byte-path bug cannot hide behind a byte-path read.
        const target = "some-target";
        const at = join(dir, "sb");
        out.push({ label: "symlink_bytes round trip", mine: m.probeSymlinkBytes(target, at), theirs: target });
        out.push({ label: "symlink_bytes agrees with node", mine: fsm.readlinkSync(at), theirs: target });
        const wb = join(dir, "wb");
        out.push({ label: "write_file_bytes_fd errno", mine: m.probeWriteBytes(wb, "bytes written"), theirs: 0 });
        out.push({ label: "write_file_bytes_fd landed", mine: readFileSync(wb, "utf8"), theirs: "bytes written" });
        const made = m.probeMkdtempBytes(join(dir, "tXXXXXX"));
        out.push({
          label: "mkdtemp_bytes",
          mine: typeof made === "string" && !made.includes("XXXXXX") && existsSync(made),
          theirs: true,
          detail: made,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return out;
    },
  },
  {
    file: "process-blind.ts",
    module: "process",
    // Five bindings whose *result is a mutation* -- they fill a caller-provided
    // array and answer an errno -- plus hrtime. These looked unprobeable until
    // it was clear a homogeneous number tuple crosses as `NtsArray *`, so the
    // array can be handed in and read back.
    checks(m) {
      const usage = process.cpuUsage();
      const mem = process.memoryUsage();
      const out = [
        { label: "cpuUsage errno + signs", mine: m.probeCpuUsage(), theirs: "0:true:true" },
        { label: "memoryUsage all columns", mine: m.probeMemoryShape(), theirs: "0:true:true:true:true:true" },
        // All sixteen uv_getrusage columns present and non-negative. A count
        // alone would pass for a binding that filled two and left fourteen
        // zeroes, which is what a short memcpy does.
        { label: "resourceUsage 16 columns", mine: m.probeResourceUsageShape(), theirs: "0:16:16" },
        { label: "hrtime monotonic", mine: m.probeHrtimeMonotonic(), theirs: true },
        { label: "hrtime is nanoseconds", mine: m.probeHrtimeIsNanoseconds(), theirs: true },
      ];
      // Figures that move between the two calls: magnitude is what is
      // comparable, and a tighter check would fail for a reason that is not a
      // defect. Loose enough not to flake, tight enough that a unit error --
      // milliseconds for microseconds, kilobytes for bytes -- cannot pass.
      const cpu = m.probeCpuUserMicros();
      out.push({
        label: "cpu user within 10x",
        mine: cpu > 0 && cpu < usage.user * 10 && cpu > usage.user / 10,
        theirs: true,
        detail: `${cpu} vs ${usage.user}`,
      });
      for (const [label, mine] of [["rss", m.probeRss()], ["memoryUsage rss", m.probeMemoryRss()]]) {
        out.push({
          label: `${label} within 25%`,
          mine: mine > 0 && Math.abs(mine - mem.rss) < mem.rss * 0.25,
          theirs: true,
          detail: `${mine} vs ${mem.rss}`,
        });
      }
      // `umask(m)` answers the *previous* mask, which is node's contract, and
      // the probe puts the original back before returning. Checked against
      // node's own reading rather than a constant.
      // maxRSS is reported in kilobytes by getrusage and bytes by memoryUsage,
      // so the comparable claim is that they describe the same process rather
      // than that they are equal.
      const maxRss = m.probeMaxRss();
      out.push({
        label: "maxRSS plausible vs rss",
        mine: maxRss > 0 && maxRss * 1024 >= mem.rss / 2,
        theirs: true,
        detail: `${maxRss}kB vs ${mem.rss}B`,
      });
      const current = process.umask();
      out.push({
        label: "umask previous/set/restored",
        mine: m.probeUmaskRoundTrip(),
        theirs: `${current}:${0o077}:${current}`,
      });
      return out;
    },
  },
  {
    file: "zlib-engine.ts",
    module: "zlib",
    // The streaming half: a handle with a lifecycle rather than one call.
    // zlib-oneshot proves the compressor emits node's bytes; this proves the
    // engine around it -- create, incremental writes, status, reset, params,
    // close. None of it was reachable before: zlib does not compile and the
    // interpreted lane's stand-ins are node's own zlib.
    checks(m) {
      const zlib = require("node:zlib");
      const asBytes = (b) => [...Buffer.from(b)].map((x) => `${x},`).join("");
      const text = "the quick brown fox jumps over the lazy dog";
      const whole = m.probeDeflateWhole(text, 6);
      const out = [
        { label: "handles are distinct", mine: m.probeHandlesAreDistinct(), theirs: true },
        { label: "deflate whole L6", mine: whole, theirs: asBytes(zlib.deflateSync(Buffer.from(text), { level: 6 })) },
        { label: "deflate whole L1", mine: m.probeDeflateWhole(text, 1), theirs: asBytes(zlib.deflateSync(Buffer.from(text), { level: 1 })) },
        // The property a stateful compressor exists to have: three writes with
        // Z_NO_FLUSH then Z_FINISH must produce the same stream as one call.
        {
          label: "stream in three == whole",
          mine: m.probeDeflateInThree("the quick ", "brown fox jumps ", "over the lazy dog"),
          theirs: whole,
        },
        { label: "bytesWritten counts input", mine: m.probeBytesWritten(text), theirs: text.length },
        { label: "streamEnded false then true", mine: m.probeStreamEndedTransition(text), theirs: "false:true" },
        // status, code, message, pending, bytesWritten -- all clean on a new
        // engine. Checked together because a fresh engine reporting a stale
        // error from a previous handle is the failure a per-field check misses.
        { label: "fresh engine is clean", mine: m.probeFreshEngineState(), theirs: "0:::false:0" },
        { label: "reset restores output", mine: m.probeResetRestores(text), theirs: true },
        { label: "params accepted", mine: m.probeParamsAccepted(), theirs: 0 },
        { label: "double close survives", mine: m.probeDoubleClose(), theirs: true },
      ];
      // The error path, against node's own errno and code for the same bytes.
      let nodeErr = "none";
      try {
        zlib.inflateSync(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
      } catch (e) {
        nodeErr = `${e.errno}:${e.code}`;
      }
      out.push({ label: "inflate garbage errno/code", mine: m.probeInflateGarbage(), theirs: nodeErr });
      return out;
    },
  },
  {
    file: "fs-dir.ts",
    module: "fs",
    // Directory reading and positional I/O -- what readdirSync, opendirSync and
    // the positional read/write forms are built on. The opendir trio is a handle
    // lifecycle, which is the kind of binding that goes wrong on the third call
    // rather than the first, so it is walked at three batch sizes.
    checks(m) {
      const fsm = require("node:fs");
      const dir = mkdtempSync(join(tmpdir(), "nts-dir-"));
      const out = [];
      try {
        writeFileSync(join(dir, "alpha"), "0123456789");
        writeFileSync(join(dir, "beta"), "x");
        fsm.mkdirSync(join(dir, "gamma"));
        fsm.symlinkSync("alpha", join(dir, "delta"));
        // UV_DIRENT_FILE 1, UV_DIRENT_DIR 2, UV_DIRENT_LINK 3.
        const nodeRows = fsm.readdirSync(dir, { withFileTypes: true })
          .map((d) => `${d.isDirectory() ? 2 : d.isSymbolicLink() ? 3 : 1}:${d.name}`)
          .sort().join("|");
        // readdir order is unspecified, so the comparison sorts. It sorts here
        // rather than in the probe because `sort` on an array of strings is
        // itself refused -- blockers/sort-array-of-references.
        const sorted = (v) => v.split("|").filter(Boolean).sort().join("|");
        out.push({ label: "scandir rows and types", mine: sorted(m.probeScandir(dir)), theirs: nodeRows });
        out.push({ label: "scandir count", mine: m.probeScandirCount(dir), theirs: fsm.readdirSync(dir).length });
        for (const batch of [1, 2, 32]) {
          out.push({ label: `opendir walk batch=${batch}`, mine: sorted(m.probeOpendirWalk(dir, batch)), theirs: nodeRows });
        }
        out.push({ label: "dir close then close", mine: m.probeDirCloseTwice(dir), theirs: "0:-9" });
        let enoent = 0;
        try { fsm.opendirSync(join(dir, "nope")); } catch (e) { enoent = e.errno; }
        out.push({ label: "opendir missing errno", mine: m.probeOpendirMissing(join(dir, "nope")), theirs: enoent });
        const f = join(dir, "alpha");
        out.push({ label: "read at 0 length 4", mine: m.probeReadAt(f, 4, 0), theirs: "0123" });
        out.push({ label: "read at 4 length 3", mine: m.probeReadAt(f, 3, 4), theirs: "456" });
        out.push({ label: "write at offset 2", mine: m.probeWriteAt(f, "ABC", 2), theirs: 3 });
        // The bytes before the offset have to survive, which the write's own
        // return value cannot show.
        out.push({ label: "write left the prefix", mine: readFileSync(f, "utf8"), theirs: "01ABC56789" });
        // Eight columns, not node's seven public StatFs properties: stats.ts:246
        // reads indices 0 through 7.
        out.push({ label: "statfs column count", mine: m.probeStatfsCount(dir), theirs: 8 });
        out.push({ label: "statfs bsize", mine: m.probeStatfsBsize(dir), theirs: fsm.statfsSync(dir).bsize });
        out.push({ label: "fchmod sets mode", mine: m.probeFchmod(f, 0o640), theirs: 0o640 });
        out.push({ label: "futimes sets mtime", mine: m.probeFutimes(f, 1000, 2000), theirs: 2000000 });
        out.push({ label: "errno clean after success", mine: m.probeErrnoAfterSuccess(dir), theirs: 0 });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return out;
    },
  },
  {
    file: "internal-full.ts",
    module: "internal",
    checks(m) {
      const fsm = require("node:fs");
      const lengths = m.probeErrorTableLengths().split(":");
      const out = [
        { label: "write_stdout returns", mine: m.probeWriteStdout(""), theirs: 0 },
        { label: "write_stderr returns", mine: m.probeWriteStderr(""), theirs: 0 },
        { label: "debug_write returns", mine: m.probeDebugWrite(""), theirs: 0 },
        { label: "uuid status clean", mine: m.probeUuidStatus(), theirs: 0 },
        // Two parallel arrays. A length check alone cannot see them drift
        // relative to each other, so the pairing is checked against node below.
        { label: "error tables same length", mine: lengths[0], theirs: lengths[1] },
        { label: "error codes are unique", mine: m.probeCodesAreUnique(), theirs: true },
        { label: "sleep 20ms actually elapses", mine: m.probeSleepElapses(20), theirs: true },
      ];
      const errorOf = (thunk) => { try { thunk(); return null; } catch (e) { return e; } };
      for (const [thunk, label] of [
        [() => fsm.statSync("/nonexistent-nts/x"), "ENOENT"],
        [() => fsm.fstatSync(9999), "EBADF"],
        [() => fsm.readFileSync("/"), "EISDIR"],
      ]) {
        const e = errorOf(thunk);
        out.push({ label: `code ${e.errno} names ${label}`, mine: m.probeNameForCode(e.errno), theirs: e.code });
      }
      return out;
    },
  },
  {
    file: "fs-more.ts",
    module: "fs",
    // Ownership, vectored I/O, and the bigint and byte-path variants of stat
    // and statfs. chown calls pass -1 for both ids, which POSIX defines as
    // "change nothing" -- the whole syscall path runs without the probe needing
    // privileges or leaving a file it did not own.
    checks(m) {
      const fsm = require("node:fs");
      const dir = mkdtempSync(join(tmpdir(), "nts-more-"));
      const f = join(dir, "a");
      const out = [];
      try {
        writeFileSync(f, "0123456789");
        const link = join(dir, "l");
        fsm.symlinkSync("a", link);
        out.push({ label: "fchown -1 -1", mine: m.probeFchownNoChange(f), theirs: 0 });
        out.push({ label: "lchown -1 -1", mine: m.probeLchownNoChange(link), theirs: 0 });
        out.push({ label: "lchown_bytes -1 -1", mine: m.probeLchownBytesNoChange(link), theirs: 0 });
        let enoent = 0;
        try { fsm.lchownSync(join(dir, "nope"), -1, -1); } catch (e) { enoent = e.errno; }
        out.push({ label: "lchown missing errno", mine: m.probeLchownMissing(join(dir, "nope")), theirs: enoent });
        // lutimes exists in order NOT to follow the link. Checked from both
        // sides: the link's mtime moved, and the target's did not become the
        // value that was set. A probe aimed at a regular file would pass for an
        // implementation that followed.
        const before = statSync(f).mtimeMs;
        out.push({ label: "lutimes moves link only", mine: m.probeLutimesOnLink(link, f, 5000), theirs: `${5000 * 1000}:false` });
        out.push({ label: "lutimes left the target", mine: statSync(f).mtimeMs, theirs: before });
        out.push({ label: "readv fills two buffers", mine: m.probeReadv(f, 4, 3), theirs: "0123456" });
        const w = join(dir, "w");
        out.push({ label: "writev returns the total", mine: m.probeWritev(w, "abc", "defg"), theirs: 7 });
        out.push({ label: "writev landed in order", mine: readFileSync(w, "utf8"), theirs: "abcdefg" });
        out.push({ label: "open_bytes succeeds", mine: m.probeOpenBytes(f), theirs: 0 });
        out.push({ label: "stat_bytes size", mine: m.probeStatBytesSize(f), theirs: 10 });
        out.push({ label: "stat_bigint_bytes size", mine: m.probeStatBigIntBytesSize(f), theirs: "10" });
        out.push({ label: "fstat_bigint size", mine: m.probeFstatBigIntSize(f), theirs: "10" });
        const bigfs = fsm.statfsSync(dir, { bigint: true });
        out.push({ label: "statfs_bytes bsize", mine: m.probeStatfsBytesBsize(dir), theirs: fsm.statfsSync(dir).bsize });
        out.push({ label: "statfs_bigint bsize", mine: m.probeStatfsBigIntBsize(dir), theirs: String(bigfs.bsize) });
        out.push({ label: "statfs_bigint_bytes bsize", mine: m.probeStatfsBigIntBytesBsize(dir), theirs: String(bigfs.bsize) });
        out.push({ label: "O_FILEMAP is 0 off Windows", mine: m.probeOFilemap(), theirs: 0 });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return out;
    },
  },
  {
    file: "process-more.ts",
    module: "process",
    // The rest of process's reachable native half. abort, execve and
    // really_exit are declared `never` and stay unreachable -- a probe that
    // forked to survive them would be measuring the fork.
    checks(m) {
      const osm = require("node:os");
      // node's `allowedNodeEnvironmentFlags` is a Set subclass whose `size` and
      // iteration disagree -- 284 against 281 on this build, because `has` and
      // `size` account for dash/underscore spellings differently. The
      // comparable count is what it *iterates*, and comparing against `.size`
      // reported a divergence for a binding that matches node flag for flag.
      const nodeFlags = [...process.allowedNodeEnvironmentFlags];
      const out = [
        { label: "allowed env flag count", mine: m.probeAllowedEnvFlagCount(), theirs: nodeFlags.length },
        { label: "allowed flags none missing", mine: nodeFlags.filter((f) => !m.probeAllowedEnvFlagHas(f)).length, theirs: 0 },
        { label: "chdir round trip", mine: m.probeChdirRoundTrip(osm.tmpdir()), theirs: "0:true:true" },
        { label: "kill self signal 0", mine: m.probeKillExistence(process.pid), theirs: 0 },
        { label: "raw_debug survives", mine: m.probeRawDebugSurvives(""), theirs: true },
        { label: "title round trip", mine: m.probeTitleRoundTrip("nts-probe"), theirs: "true:true" },
        { label: "setuid to self", mine: m.probeSetuidSelf(process.getuid()), theirs: 0 },
        { label: "setgid to self", mine: m.probeSetgidSelf(process.getgid()), theirs: 0 },
        { label: "seteuid to self", mine: m.probeSeteuidSelf(process.geteuid()), theirs: 0 },
        { label: "setegid to self", mine: m.probeSetegidSelf(process.getegid()), theirs: 0 },
        { label: "thread cpu usage", mine: m.probeThreadCpuUsage(), theirs: "0:true:true" },
      ];
      let chdirErr = 0;
      try { process.chdir("/nonexistent-nts/x"); } catch (e) { chdirErr = e.errno; }
      out.push({ label: "chdir missing errno", mine: m.probeChdirMissing("/nonexistent-nts/x"), theirs: chdirErr });
      let killErr = 0;
      try { process.kill(2147483600, 0); } catch (e) { killErr = e.errno; }
      out.push({ label: "kill absent pid errno", mine: m.probeKillMissing(2147483600), theirs: killErr });
      out.push({ label: "load_env_file missing", mine: m.probeLoadEnvFileMissing("/nonexistent-nts/.env"), theirs: -2 });
      // The privileged setters, on the only path this process can take. As a
      // non-root user each is refused with UV_EPERM, which is a real answer
      // about a real syscall rather than a skipped row. setgroups is probed
      // only this way: succeeding would change the group set of the process
      // running the tests.
      for (const [label, mine] of [
        ["setuid root", m.probeSetuidRoot()],
        ["setgroups", m.probeSetgroupsRefused()],
        ["initgroups", m.probeInitgroupsRefused()],
      ]) {
        out.push({ label: `${label} refused with EPERM`, mine, theirs: -1 });
      }
      for (const name of ["release", "features", "config"]) {
        out.push({ label: `metadata ${name} non-empty`, mine: m.probeMetadataLength(name) > 0, theirs: true });
      }
      return out;
    },
  },
  {
    file: "zlib-params.ts",
    module: "zlib",
    // brotli and zstd, which reach the same engine through the parameterized
    // form -- settings as two parallel arrays rather than fixed arguments.
    // node is byte-deterministic for both, so these compare bytes rather than
    // round-trips.
    checks(m) {
      const zlib = require("node:zlib");
      const BROTLI_DECODE = 8, BROTLI_ENCODE = 9, ZSTD_COMPRESS = 10, ZSTD_DECOMPRESS = 11;
      const asBytes = (b) => [...Buffer.from(b)].map((x) => `${x},`).join("");
      const text = "the quick brown fox jumps over the lazy dog";
      const out = [
        { label: "create_params brotli", mine: m.probeCreateParams(BROTLI_ENCODE), theirs: true },
        { label: "create_params zstd", mine: m.probeCreateParams(ZSTD_COMPRESS), theirs: true },
        { label: "create_params with a setting", mine: m.probeCreateParamsWithSetting(BROTLI_ENCODE, 0, 0), theirs: true },
        { label: "brotli oneshot bytes", mine: m.probeOneshotParams(BROTLI_ENCODE, text), theirs: asBytes(zlib.brotliCompressSync(Buffer.from(text))) },
        { label: "brotli round trip", mine: m.probeParamsRoundTrip(BROTLI_ENCODE, BROTLI_DECODE, text), theirs: text },
        { label: "zstd round trip", mine: m.probeParamsRoundTrip(ZSTD_COMPRESS, ZSTD_DECOMPRESS, text), theirs: text },
        { label: "last error message clean", mine: m.probeLastErrorMessageClean(), theirs: "" },
        { label: "last status clean", mine: m.probeLastStatusClean(), theirs: 0 },
      ];
      // zstd arrived in node 23; skip rather than fail on an older runtime, and
      // say which happened rather than reporting a pass either way.
      if (typeof zlib.zstdCompressSync === "function") {
        out.push({ label: "zstd oneshot bytes", mine: m.probeOneshotParams(ZSTD_COMPRESS, text), theirs: asBytes(zlib.zstdCompressSync(Buffer.from(text))) });
      } else {
        console.log("      note: node here has no zstdCompressSync, so that row did not run");
      }
      return out;
    },
  },
  {
    file: "fs-last.ts",
    module: "fs",
    checks(m) {
      const fsm = require("node:fs");
      const dir = mkdtempSync(join(tmpdir(), "nts-last-"));
      const out = [];
      try {
        writeFileSync(join(dir, "alpha"), "0123456789");
        fsm.mkdirSync(join(dir, "beta"));
        const nodeRows = fsm.readdirSync(dir, { withFileTypes: true })
          .map((d) => `${d.isDirectory() ? 2 : d.isSymbolicLink() ? 3 : 1}:${d.name}`)
          .sort().join("|");
        const sorted = (v) => v.split("|").filter(Boolean).sort().join("|");
        out.push({ label: "scandir_bytes rows", mine: sorted(m.probeScandirBytes(dir)), theirs: nodeRows });
        for (const batch of [1, 32]) {
          out.push({ label: `opendir_bytes batch=${batch}`, mine: sorted(m.probeOpendirBytesWalk(dir, batch)), theirs: nodeRows });
        }
        let enoent = 0;
        try { fsm.opendirSync(join(dir, "nope")); } catch (e) { enoent = e.errno; }
        out.push({ label: "opendir_bytes missing", mine: m.probeOpendirBytesMissing(join(dir, "nope")), theirs: enoent });
        const f = join(dir, "alpha");
        out.push({ label: "read_bigint agrees at 0", mine: m.probeReadBigIntAgrees(f, 4, 0), theirs: true });
        out.push({ label: "read_bigint agrees at 4", mine: m.probeReadBigIntAgrees(f, 3, 4), theirs: true });
        out.push({ label: "read_bigint reads at 4", mine: m.probeReadBigIntAt(f, 3, 4), theirs: "456" });
        // A position past 2^53 must read nothing rather than wrap to a small
        // offset. If the bigint were truncated through a double this returns
        // the head of the file, which is the failure the binding exists to
        // avoid and the only one this probe can actually stage.
        out.push({ label: "position past 2^53 reads none", mine: m.probeReadBigIntHugePosition(f), theirs: 0 });
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
  for (const c of bad) {
    // A check written as `mine: /re/.test(x)` throws x away, and then a DIFF
    // says `mine=false` -- which is the least useful thing it could say. Any
    // check may carry `detail` with what was actually observed.
    const detail = c.detail === undefined ? "" : `  saw ${JSON.stringify(c.detail)}`;
    console.log(`      DIFF  ${c.label}: mine=${c.mine} node=${c.theirs}${detail}`);
  }
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
