// What to compare, and what to compare it on.
//
// Shared by both differential lanes so that the compiled artifact and the
// TypeScript module are asked the *same* questions. A corpus that differed
// between the two would make a divergence between lanes indistinguishable from
// a divergence between corpora.
//
// Adding a module is adding an entry: how to build an input, and which calls to
// make with it. Keep the generators seeded and pure -- both lanes generate the
// inputs independently and must produce the identical sequence, so anything
// non-deterministic here silently compares different things.
//
// A call is either `{ name, args }`, which invokes `module[name](...args)`, or
// `{ label, call }`, which is handed the module and the input and does
// whatever it likes. The second exists because the interesting behaviour is
// not always a top-level function: `Buffer.from(s, "base64").toString("utf8")`
// is a round trip through two encodings and one class, and there is no export
// named for it.

/** A seeded PRNG. Same seed, same sequence, in every process. */
import { Readable, Writable } from "node:stream";

export function makeRandom(seed = 0x9e3779b9) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const choose = (rnd, xs) => xs[Math.floor(rnd() * xs.length)];

// Ranges chosen to cross the boundaries a codec actually has: ASCII, Latin-1,
// Greek and Cyrillic, CJK, emoji, and the astral planes, which is where
// surrogate handling either works or does not.
const RANGES = [
  [0x20, 0x7e], [0xa0, 0x24f], [0x370, 0x4ff],
  [0x4e00, 0x9fff], [0x1f300, 0x1f9ff], [0x10000, 0x10ffff],
];

function unicodeWord(rnd, maxLength = 12) {
  const n = 1 + Math.floor(rnd() * maxLength);
  let s = "";
  for (let i = 0; i < n; i++) {
    const [lo, hi] = choose(rnd, RANGES);
    s += String.fromCodePoint(lo + Math.floor(rnd() * (hi - lo + 1)));
  }
  return s;
}

// `console` was attempted and is deliberately absent. Its output *is* its
// behaviour, so a corpus has to capture it, and node's `Console` will not write
// to a hand-made stream: given `{ write, on, removeListener, ... }` it produces
// nothing at all and reports no error, so every comparison came back as node
// saying `""`. Giving both sides a real `Writable` is what it would take, and
// under the substitution `require("stream")` is this profile's on one side and
// node's on the other -- which would make a difference between the two streams
// indistinguishable from a difference between the two consoles.
//
// Worth recording rather than leaving as an absence: the first version of that
// corpus reported 1,839 divergences, and every one of them was the stub.
// A per-invocation counter for `diagnostics_channel`, whose registry is keyed by
// name process-wide. Deterministic: both lanes walk the same inputs in order.
let dcInvocation = 0;

/**
 * Values a validating function rejects, for the error-path calls below.
 *
 * The corpora generate inputs a function **accepts**, which is what they were
 * for -- and it left the error paths entirely uncompared. Over 400 generated
 * inputs plus the fixed ones, nineteen of twenty-one corpora threw **zero**
 * times; `buffer`'s 811 throws were all `atob`, and `punycode`'s 424 carried no
 * `code` at all. `assert.throws(fn, { code })` is how node's own suite states
 * nearly every error expectation, so the shape node's tests lean on hardest was
 * the shape these harnesses never saw.
 *
 * Indexed by something derived from the input rather than fixed, so a module's
 * error calls are a spread of rejected values and not one case repeated four
 * thousand times.
 */
export const REJECTED = [null, undefined, 1, true, {}, [], 1.5, -0];

/** A rejected value that varies with `s`, deterministically. */
export const rejected = (s) => REJECTED[String(s).length % REJECTED.length];

/**
 * The same, restricted to values that are not numbers.
 *
 * For an argument that may be a **file descriptor**, and for anything else where
 * a number is a legitimate value rather than a rejected one.
 *
 * `fs.readFileSync` takes a path *or* an fd, so the numbers in `REJECTED` are not
 * rejected there at all -- they are descriptors. `readFileSync(1)` answers
 * `EBADF` because stdout is not readable, and `readFileSync(-0)` **reads
 * descriptor 0** and blocks on stdin. That is not a slow corpus, it is a corpus
 * that hangs the harness, and it did.
 *
 * So an argument that can be an fd gets the non-numeric values only. Recorded
 * rather than quietly fixed because the shape recurs: a value is "invalid" only
 * with respect to a particular parameter, and a shared table of rejected values
 * is a claim about every parameter it is used on.
 */
export const REJECTED_NON_NUMERIC = [null, undefined, true, {}, []];

// `Symbol("not a path")` was in that list and found a **real divergence**, which
// is recorded rather than kept in the rotation:
//
//     fs.readFileSync(Symbol())
//       ours  TypeError: The "path" argument must be of type string or an
//             instance of Buffer or URL ...        [ERR_INVALID_ARG_TYPE]
//       node  TypeError: Cannot convert a Symbol value to a number   [no code]
//
// `readFileSync` takes a path *or* a descriptor, so node, having decided the
// value is not a path, treats it as a descriptor and coerces it -- and the engine
// throws before node's own validation runs. Ours validates the path type first
// and produces the better message, which is not node's.
//
// It is out of the rotation because it produced 590 identical rows in every `fs`
// run, and a harness whose output is 590 copies of a known difference buries the
// next unknown one. Removing it to make a number green would be the other
// mistake; the difference is in the ledger and can be argued with there.

export const rejectedNonNumeric = (s) =>
  REJECTED_NON_NUMERIC[String(s).length % REJECTED_NON_NUMERIC.length];

export const CORPORA = {
  // `os` is almost entirely C bindings, and until now nothing compared any of
  // them to node. The interpreted lane cannot: its stand-ins call node's own
  // `os.hostname()`, `os.tmpdir()` and so on, so that lane agrees with node by
  // construction whatever the C does. This corpus is the first thing that asks.
  //
  // It exists because `os.tmpdir()` was found disagreeing with node the day the
  // module first loaded as an addon -- libuv stops at the first environment
  // variable that is *present*, node at the first *non-empty* one. That bug had
  // been in the C since the binding was written and no instrument could see it.
  // So the input here is an environment rather than a string: the defect was in
  // which variable was consulted, not in what was done with the value.
  os: {
    // **Addon-only, and this flag is the whole reason the corpus is honest.**
    // On the interpreted lane every one of these calls resolves to node's own
    // `os` through the binding stand-ins, so a TypeScript-lane run would compare
    // node against node and report zero divergences for ever. That is a green
    // number that cannot fail -- exactly what this corpus was written to expose
    // elsewhere -- so `differential-ts.mjs` skips it and says why.
    addonOnly: true,
    fixed: [
      ["/tmpdir", "/tmp", "/temp"],
      ["", "/tmp", "/temp"],
      ["", "", "/temp"],
      ["", "", ""],
      ["/tmpdir/", "", ""],
      ["/tmpdir\\", "", ""],
      ["/", "", ""],
      ["//", "", ""],
      [undefined, "/tmp", "/temp"],
      [undefined, undefined, "/temp"],
      [undefined, undefined, undefined],
      ["/a b/c", "", ""],
      ["/ünïcode", "", ""],
      ["relative/path", "", ""],
    ],
    input: (rnd) => {
      const pick = () => {
        const n = rnd() % 5;
        if (n === 0) return undefined;
        if (n === 1) return "";
        if (n === 2) return "/t" + (rnd() % 100).toString();
        if (n === 3) return "/t" + (rnd() % 100).toString() + "/";
        return "/";
      };
      return [pick(), pick(), pick()];
    },
    calls: [
      // Five names the corpus did not reach until a coverage audit said so:
      // `getPriority`, `setPriority`, `userInfo`, `networkInterfaces`, `cpus`.
      // `os` publishes twenty functions and this file was calling fifteen.
      //
      // `setPriority` appears through its **validation only**. A successful
      // call renices the host process, which a comparison corpus has no
      // business doing, so every input here is one that must throw before it
      // reaches the system call -- and both lanes are asked for the `code`.
      {
        label: "getPriority",
        call: (m, s) => {
          const pid = s === "" ? undefined : Number(s);
          try {
            const v = m.getPriority(Number.isNaN(pid) ? s : pid);
            return ["ok", typeof v, Number.isInteger(v)];
          } catch (e) {
            return ["threw", (e && e.code) || "?", (e && e.name) || "?"];
          }
        },
      },
      {
        label: "setPriority-validation",
        call: (m, s) => {
          // Deliberately invalid in every case: a bad pid or a bad priority,
          // never a pair that would succeed and change the host.
          try {
            m.setPriority(s === "" ? "not-a-pid" : s, 1e9);
            return ["ACCEPTED-should-not-happen"];
          } catch (e) {
            return ["threw", (e && e.code) || "?", (e && e.name) || "?"];
          }
        },
      },
      {
        // **A bad `priority` behind a valid `pid`, which the spec above never
        // reaches.** That one puts its bad value in the *first* argument, and the
        // first argument was never the broken one: on 2026-09-10 the compiled
        // lane answered `ERR_OUT_OF_RANGE` here where node answers
        // `ERR_INVALID_ARG_TYPE`, and this corpus read 0 divergences throughout.
        // `test-os-process-priority.js` is what found it.
        //
        // The prefix keeps the value non-numeric whatever happens to it on the
        // way in. `setPriority(0, "5")` would be one coercion away from actually
        // renicing the host, and a corpus spec must not be able to do that.
        label: "setPriority-priority-validation",
        call: (m, s) => {
          try {
            m.setPriority(0, `p${s}`);
            return ["ACCEPTED-should-not-happen"];
          } catch (e) {
            return ["threw", (e && e.code) || "?", (e && e.name) || "?"];
          }
        },
      },
      {
        label: "userInfo-shape",
        call: (m) => {
          try {
            const u = m.userInfo();
            return ["ok", typeof u.username, typeof u.homedir, typeof u.uid, typeof u.gid];
          } catch (e) {
            return ["threw", (e && e.code) || (e && e.name)];
          }
        },
      },
      {
        label: "networkInterfaces-shape",
        call: (m) => {
          try {
            const n = m.networkInterfaces();
            const keys = Object.keys(n).sort();
            const first = keys.length > 0 ? n[keys[0]] : [];
            return ["ok", Array.isArray(first), first.length > 0 ? typeof first[0].address : "none"];
          } catch (e) {
            return ["threw", (e && e.code) || (e && e.name)];
          }
        },
      },
      {
        label: "cpus-shape",
        shapeOnly: true,
        call: (m) => {
          try {
            const c = m.cpus();
            return ["ok", Array.isArray(c), c.length > 0 ? typeof c[0].model : "none",
                    c.length > 0 ? typeof c[0].times.user : "none"];
          } catch (e) {
            return ["threw", (e && e.code) || (e && e.name)];
          }
        },
      },

      {
        label: "tmpdir",
        // The environment is the input, so it is applied before each call and
        // both sides see the same one. `delete` rather than `= ""`, because an
        // absent variable and an empty one are exactly the distinction the
        // original defect turned on.
        call: (os, env) => {
          const names = ["TMPDIR", "TMP", "TEMP"];
          for (let i = 0; i < names.length; i++) {
            const name = names[i];
            if (env[i] === undefined) delete process.env[name];
            else process.env[name] = env[i];
          }
          return os.tmpdir();
        },
      },
      // The stable system values. These cannot differ between two calls on one
      // machine, so any disagreement is the binding rather than the world.
      { label: "hostname", call: (os) => os.hostname() },
      { label: "type", call: (os) => os.type() },
      { label: "release", call: (os) => os.release() },
      { label: "version", call: (os) => os.version() },
      { label: "machine", call: (os) => os.machine() },
      { label: "arch", call: (os) => os.arch() },
      { label: "platform", call: (os) => os.platform() },
      { label: "endianness", call: (os) => os.endianness() },
      { label: "homedir", call: (os) => os.homedir() },
      { label: "totalmem", call: (os) => os.totalmem() },
      { label: "availableParallelism", call: (os) => os.availableParallelism() },
      { label: "EOL", call: (os) => os.EOL },
      { label: "devNull", call: (os) => os.devNull },
      // `freemem`, `uptime` and `loadavg` move between calls, so their *values*
      // cannot be compared. Their shapes can, and a binding returning the wrong
      // type or an error is what would actually break.
      // `shapeOnly` on these three, and it is a declaration rather than an excuse.
      // A differential compares two answers, and these three quantities *cannot*
      // agree by value: free memory and uptime move between the two calls, and
      // `cpus()` carries per-core times that advance while it runs. So the spec
      // asks the only question that has a stable answer -- the type -- and the
      // cost is that it can catch a value that stops being a number and nothing
      // finer. `--sabotage` reports them apart so an unexplained silence stays
      // legible as a finding.
      { label: "freemem:shape", shapeOnly: true, call: (os) => typeof os.freemem() },
      { label: "uptime:shape", shapeOnly: true, call: (os) => typeof os.uptime() },
      {
        label: "loadavg:shape",
        call: (os) => {
          const v = os.loadavg();
          return `${Array.isArray(v)}:${v.length}:${typeof v[0]}`;
        },
      },
    ],
  },

  punycode: {
    fixed: [
      "", "a", "abc", "-", "--", "xn--", "0", "z", " ", "  ", "\t", "\n",
      ".", "..", "a..b", "a.", ".a", "xn--a", "xn--0zwm56d",
      "mañana", "bücher", "日本語", "☃", "😀", "a😀b", "\u{10FFFF}",
      "москва", "北京", "ｅｘａｍｐｌｅ", "ß", "a".repeat(200), "ü".repeat(60),
    ],
    input: (rnd) => unicodeWord(rnd),
    calls: [
      { name: "encode", args: (s) => [s] },
      { name: "decode", args: (s) => [s] },
      { name: "toASCII", args: (s) => [s] },
      { name: "toUnicode", args: (s) => [s] },
      // `ucs2` and `version` are published and were not compared, which meant
      // the module reported "0 divergences" over four of its six names. `ucs2`
      // is the one that took the most work to publish -- an exported object
      // literal of functions -- so it is the last export that should have gone
      // unchecked.
      { label: "ucs2.decode", call: (m, s) => m.ucs2.decode(s) },
      {
        label: "ucs2.encode",
        // Encode takes code points, so they are derived from the same input
        // rather than generated separately: this compares the *pair* on one
        // value, which is what the module is actually used for.
        call: (m, s) => m.ucs2.encode(m.ucs2.decode(s)),
      },
      { label: "version", call: (m) => m.version },
    ],
    // `decode(encode(s))` is the identity on anything `encode` accepts, checked
    // against the implementation alone rather than against node: a round trip
    // that agrees with node while losing the input would be two bugs
    // cancelling. Used by the addon lane, which is the one that can regress.
    property: (m, input) => {
      let encoded;
      try {
        encoded = m.encode(input);
      } catch {
        // Refusing an input is not a round-trip failure; there is nothing to
        // decode. A divergence in *whether* it refuses is caught by the
        // comparison, which is where it belongs.
        return undefined;
      }
      try {
        const back = m.decode(encoded);
        return back === input ? undefined : `round-trip returned ${JSON.stringify(back)}`;
      } catch (error) {
        // The loudest round-trip failure there is: `encode` produced something
        // its own `decode` rejects. Reported rather than propagated -- letting
        // it throw crashed the whole run the first time this had a real defect
        // in front of it, which is a differential failing to report the thing
        // it exists to report.
        return `encode produced ${JSON.stringify(encoded)}, which its own decode rejects: ${error.message}`;
      }
    },
  },

  path: {
    fixed: [
      "", "/", "//", "///", ".", "..", "./", "../", "a", "/a", "a/", "/a/",
      "a//b", "a/./b", "a/../b", "/a/../..", "c.txt", ".hidden", "a.b.c",
      "  ", "a b", "ü/日", "/a/b/../../c", "....", "a/", "//server/share",
      "C:", "C:/", "C:\\\\", "C:a", "C:/a", "c:/A", "\\\\", "\\\\\\\\",
      "\\\\\\\\server\\\\share", "\\\\\\\\server\\\\share\\\\a", "\\\\\\\\?\\\\C:\\\\a",
      "\\\\\\\\.\\\\pipe\\\\x", "a\\\\b", "a\\\\\\\\b", "C:\\\\a\\\\..\\\\b", "//?/C:/a",
    ],
    input: (rnd) => {
      const PARTS = ["a", "bb", ".", "..", "", "c.txt", "d.", ".e", "f g", "ü", "日", "...", "x.y.z",
        "C:", "C:/", "c:", "\\\\server", "\\\\?\\C:", "$", "con", "nul"];
      const SEPS = ["/", "//", "///", "/./", "/../", "\\\\", "\\\\\\\\", "\\\\.\\\\", "/\\\\"];
      let s = rnd() < 0.4 ? "/" : "";
      const k = 1 + Math.floor(rnd() * 5);
      for (let j = 0; j < k; j++) s += (j ? choose(rnd, SEPS) : "") + choose(rnd, PARTS);
      if (rnd() < 0.2) s += choose(rnd, SEPS);
      return s;
    },
    // Both namespaces. `win32` is a second implementation over shared helpers,
    // with drive letters, UNC shares and backslash separators, and testing only
    // the default namespace left half of `node:path` uncompared -- on the host
    // this runs on, the default *is* posix.
    calls: [
      // Error paths: the same functions handed a value they must reject. Both
      // sides have to throw, and to throw the *same* error with the same
      // `code` -- which is the half `name: message` alone could not check.
      ...["posix", "win32"].flatMap((ns) => [
        { label: `${ns}.normalize!`, throws: true, call: (m, s) => m[ns].normalize(rejected(s)) },
        { label: `${ns}.basename!`, throws: true, call: (m, s) => m[ns].basename(rejected(s)) },
        { label: `${ns}.resolve!`, throws: true, call: (m, s) => m[ns].resolve(rejected(s)) },
        { label: `${ns}.join!`, throws: true, call: (m, s) => m[ns].join(s, rejected(s)) },
      ]),
      ...["posix", "win32"].flatMap((ns) => [
        { label: `${ns}.normalize`, call: (m, s) => m[ns].normalize(s) },
        { label: `${ns}.dirname`, call: (m, s) => m[ns].dirname(s) },
        { label: `${ns}.basename`, call: (m, s) => m[ns].basename(s) },
        { label: `${ns}.extname`, call: (m, s) => m[ns].extname(s) },
        { label: `${ns}.isAbsolute`, call: (m, s) => m[ns].isAbsolute(s) },
        { label: `${ns}.parse`, call: (m, s) => m[ns].parse(s) },
        { label: `${ns}.format`, call: (m, s) => m[ns].format(m[ns].parse(s)) },
        { label: `${ns}.join`, call: (m, s) => m[ns].join(s, "z") },
        { label: `${ns}.relative`, call: (m, s) => m[ns].relative(s, "/tmp") },
        { label: `${ns}.toNamespacedPath`, call: (m, s) => m[ns].toNamespacedPath(s) },
      ]),
      { name: "resolve", args: (s) => [s] },
      // The **top-level names**, which were never called. Everything above goes
      // through `posix.` or `win32.`, so the corpus reached 21 of `path`'s 39
      // functions and none of the twelve the module publishes directly.
      //
      // This is not redundancy. On a posix host `path.normalize` should *be*
      // `path.posix.normalize` -- the same function object, not merely one that
      // agrees -- and an alias that stops aliasing is a break no pinned test
      // catches. `path._makeLong` was exactly that failure earlier today: it
      // answered correctly while being a *different* function from
      // `toNamespacedPath`, which `local/legacy-make-long.js` asserts with
      // `strictEqual`. Identity is compared here alongside the answers.
      {
        label: "top-level-answers",
        call: (m, s2) => [
          m.normalize(s2),
          m.dirname(s2),
          m.basename(s2),
          m.extname(s2),
          m.isAbsolute(s2),
          m.join(s2, "z"),
          m.relative(s2, "/tmp"),
          m.toNamespacedPath(s2),
        ],
      },
      {
        label: "top-level-identity",
        call: (m) => {
          const platform = m.sep === "\\" ? m.win32 : m.posix;
          const names = ["normalize", "dirname", "basename", "extname", "isAbsolute",
                         "join", "relative", "toNamespacedPath", "resolve", "parse", "format"];
          const out = [];
          for (const n of names) out.push(`${n}:${m[n] === platform[n]}`);
          out.push(`_makeLong-is-toNamespacedPath:${m._makeLong === m.toNamespacedPath}`);
          out.push(`self:${m.posix === m || m.win32 === m}`);
          return out;
        },
      },
    ],
  },

  fs: {
    // Read-only, against a directory that is in the repository, so both
    // processes see byte-identical state without either of them writing
    // anything. What is compared is *path handling and error codes* -- a
    // trailing slash on a file, a `..` that escapes, a NUL byte, an empty
    // string -- which is where two implementations of the same syscalls
    // disagree even when the syscalls do not.
    //
    // Nothing here creates, moves or removes a file. A differential that
    // mutates shared state is a differential whose two sides ran against
    // different filesystems.
    fixed: [
      "", "/", ".", "..", "./", "../", "src", "src/", "src/main.ts",
      "src/main.ts/", "src/main.ts/.", "nope", "nope/", "src//main.ts",
      "src/./main.ts", "src/../src/main.ts", "../punycode/src/main.ts",
      "src/main.ts\u0000", "\u0000", "ü", "日", " ", "  ", "src ",
    ],
    input: (rnd) => {
      const PARTS = ["src", "main.ts", "..", ".", "", "nope", "ü", " ", "shape.mjs"];
      const SEPS = ["/", "//", "/./", "/../"];
      let out = "";
      const k = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < k; i++) out += (i ? choose(rnd, SEPS) : "") + choose(rnd, PARTS);
      if (rnd() < 0.25) out += choose(rnd, SEPS);
      return out;
    },
    // Asserted rather than compared, because comparison cannot see it: if the
    // base were missing, both sides would answer ENOENT to everything and the
    // corpus would report perfect agreement over nothing at all. Demonstrated
    // by pointing it at a directory that does not exist, which fails the run
    // with the reason rather than passing with 2,268 comparisons.
    precondition: (fs) => {
      const base = `${new URL(".", import.meta.url).pathname}../../runtime/node/punycode/`;
      if (!fs.existsSync(base)) return `no such directory: ${base}`;
      if (!fs.statSync(base).isDirectory()) return `not a directory: ${base}`;
      return fs.readdirSync(base).includes("src") ? true : "the fixture directory is empty";
    },
    calls: (() => {
      // Absolute, derived from this file rather than from the working
      // directory. A relative base would make both sides fail identically from
      // any other cwd -- ENOENT equals ENOENT -- and the corpus would report
      // agreement while comparing nothing.
      const HERE = new URL(".", import.meta.url).pathname;
      const BASE = `${HERE}../../runtime/node/punycode/`;
      const attempt = (fn) => {
        try {
          return `ok:${fn()}`;
        } catch (error) {
          return `${error.code ?? error.name}`;
        }
      };
      return [
        // Error paths. See `REJECTED` above.
        { label: "readFileSync!", throws: true, call: (m, s) => m.readFileSync(rejectedNonNumeric(s)) },
        { label: "openSync!", throws: true, call: (m, s) => m.openSync(rejectedNonNumeric(s)) },
        { label: "existsSync", call: (m, s) => attempt(() => m.existsSync(BASE + s)) },
        // **The asynchronous read-only half, unreachable until the harness could await.**
        //
        // `corpus-reach.mjs` put this module at 9 of 169 published functions called, and the
        // reason was structural rather than a thin corpus: the differential was synchronous, so
        // every callback form and the whole of `fs.promises` was out of reach by construction.
        //
        // Read-only, for the reason stated at the top of this corpus: a differential that mutates
        // shared state is one whose two sides ran against different filesystems. Nothing below
        // creates, moves or removes anything, and `open` closes in every path -- 4,000 inputs
        // against a leaking descriptor would exhaust the process rather than report a divergence.
        {
          // **`fs.promises`, the other half that could not be awaited.** Same read-only rule,
          // same base directory. `open` is included because a `FileHandle` must be closed and
          // this is the only spec in a position to prove that it can be -- 4,000 inputs holding
          // handles would exhaust the process rather than report a divergence.
          // **The read-only stream and descriptor half.** `createReadStream`, the descriptor
          // family (`open`/`read`/`readv`/`fstat`/`close`), directory handles and `statfs` are
          // all reads, so they are admissible under this corpus's standing rule: nothing here
          // creates, moves or removes anything. The *writing* half of `fs` stays out, and that
          // is a rule about shared state rather than a gap in the harness.
          //
          // Every descriptor and directory handle is closed on every path. 4,000 inputs leaking
          // one apiece would exhaust the process rather than report a divergence, which is a
          // failure mode this corpus has already produced once, from a listening server.
          label: "read-only-streams",
          call: async (m, s) => {
            const at = BASE + s;
            // **Every asynchronous arm gets a deadline, and this spec is why the rule is not
            // optional.** Without one, the read-stream arm never settled under
            // `corpus-reach.mjs`, which instruments a module's functions before running the
            // corpus over it: the instrumented stream did not emit what the arm was waiting for,
            // and the tool died with "Detected unsettled top-level await" and printed **nothing
            // at all**. A spec that can hang does not hang only in the harness it was written
            // for. `net`'s spec had a deadline and this one did not.
            const withDeadline = (make) =>
              new Promise((resolve) => {
                // **Reffed, and that is the whole point of it.** `unref()` here defeated the
                // deadline entirely: an unreffed timer does not hold the loop, so the loop
                // drained with the promise unsettled and the tool still died with "Detected
                // unsettled top-level await". A deadline exists to make something settle; it
                // cannot do that from outside the thing keeping the process alive.
                //
                // It costs nothing when the arm answers, because it is cleared immediately. It
                // costs two seconds exactly when an arm would otherwise hang forever.
                const timer = setTimeout(() => resolve("timeout"), 2000);
                Promise.resolve()
                  .then(make)
                  .then((v) => { clearTimeout(timer); resolve(v); })
                  .catch((error) => { clearTimeout(timer); resolve(`${error?.code ?? error?.name ?? "?"}`); });
              });
            const settle = (make) => withDeadline(async () => `ok:${await make()}`);
            return [
              // A read stream's bytes, and that it ends. `encoding` is left off so the
              // comparison is over buffers rather than a decoder's opinion.
              await settle(() => new Promise((resolve, reject) => {
                const stream = m.createReadStream(at);
                const chunks = [];
                stream.on("data", (chunk) => chunks.push(chunk));
                stream.on("error", reject);
                stream.on("close", () => resolve(`bytes:${Buffer.concat(chunks).length}`));
              })),
              // The descriptor family, closed on both paths.
              await settle(async () => {
                const fd = m.openSync(at, "r");
                try {
                  const stat = m.fstatSync(fd);
                  const buffer = Buffer.alloc(8);
                  const read = m.readSync(fd, buffer, 0, 8, 0);
                  return `file=${stat.isFile()} read=${read}`;
                } finally { m.closeSync(fd); }
              }),
              // `readv` into two views, which is where an offset is got wrong.
              await settle(async () => {
                const fd = m.openSync(at, "r");
                try {
                  const views = [Buffer.alloc(3), Buffer.alloc(5)];
                  const read = m.readvSync(fd, views);
                  return `read=${read} first=${views[0].length}`;
                } finally { m.closeSync(fd); }
              }),
              // A directory handle, iterated and closed.
              await settle(async () => {
                if (m.opendirSync === undefined) return "absent";
                const dir = m.opendirSync(at);
                try {
                  const names = [];
                  for (;;) {
                    const entry = dir.readSync();
                    if (entry === null) break;
                    names.push(`${entry.name}:${entry.isFile()}${entry.isDirectory()}`);
                  }
                  return names.sort().join(",");
                } finally { dir.closeSync(); }
              }),
              await settle(() => (m.statfsSync === undefined
                ? "absent"
                : typeof m.statfsSync(at).type)),
              // `glob` over the fixture directory, sorted so the order is not the question.
              await settle(() => (m.globSync === undefined
                ? "absent"
                : m.globSync("*.mjs", { cwd: at }).slice().sort().join(","))),
            ].join("|");
          },
        },
        {
          label: "promises-read-only",
          call: async (m, s) => {
            const at = BASE + s;
            const p = m.promises;
            if (p === undefined) return "absent";
            const settle = async (make) => {
              try {
                return `ok:${await make()}`;
              } catch (error) {
                return `${error.code ?? error.name}`;
              }
            };
            const kind = (st) => `${st.isFile()}/${st.isDirectory()}/${st.isSymbolicLink()}`;
            return [
              await settle(async () => { await p.access(at, 0); return "yes"; }),
              await settle(async () => kind(await p.stat(at))),
              await settle(async () => kind(await p.lstat(at))),
              await settle(async () => (await p.readdir(at)).slice().sort().join(",")),
              await settle(async () => (await p.readFile(at)).length),
              await settle(async () => { await p.realpath(at); return "resolved"; }),
              await settle(async () => { await p.readlink(at); return "link"; }),
              await settle(async () => {
                const handle = await p.open(at, "r");
                try { return `opened:${(await handle.stat()).isFile()}`; }
                finally { await handle.close(); }
              }),
            ].join("|");
          },
        },
        {
          label: "async-read-only",
          call: async (m, s) => {
            const at = BASE + s;
            const cb = (fn, ...args) =>
              new Promise((resolve) => {
                if (typeof fn !== "function") { resolve("absent"); return; }
                try {
                  fn(...args, (error, out) => {
                    resolve(error ? `${error.code ?? error.name}` : `ok:${out}`);
                  });
                } catch (error) {
                  resolve(`${error.code ?? error.name}`);
                }
              });
            const kind = async (fn) => {
              const st = await new Promise((resolve) => {
                try { fn(at, (error, v) => resolve(error ? null : v)); } catch { resolve(null); }
              });
              return st === null ? "err" : `${st.isFile()}/${st.isDirectory()}/${st.isSymbolicLink()}`;
            };
            // `open` then `close` on both outcomes, so a descriptor never outlives one input.
            const opened = await new Promise((resolve) => {
              try {
                m.open(at, "r", (error, fd) => {
                  if (error) { resolve(`${error.code ?? error.name}`); return; }
                  m.close(fd, () => resolve("ok:opened"));
                });
              } catch (error) { resolve(`${error.code ?? error.name}`); }
            });
            return [
              await cb(m.access, at, 0),
              await kind(m.stat),
              await kind(m.lstat),
              await cb(m.realpath, at).then((r) => (r.startsWith("ok:") ? "ok:resolved" : r)),
              await cb(m.readlink, at).then((r) => (r.startsWith("ok:") ? "ok:link" : r)),
              await new Promise((resolve) => {
                try {
                  m.readdir(at, (error, names) => {
                    resolve(error ? `${error.code ?? error.name}` : `ok:${names.slice().sort().join(",")}`);
                  });
                } catch (error) { resolve(`${error.code ?? error.name}`); }
              }),
              await new Promise((resolve) => {
                try {
                  m.readFile(at, (error, data) => {
                    resolve(error ? `${error.code ?? error.name}` : `ok:${data.length}`);
                  });
                } catch (error) { resolve(`${error.code ?? error.name}`); }
              }),
              opened,
            ].join("|");
          },
        },
        {
          label: "statSync kind",
          call: (m, s) =>
            attempt(() => {
              const st = m.statSync(BASE + s);
              return `${st.isFile()}/${st.isDirectory()}/${st.isSymbolicLink()}`;
            }),
        },
        {
          label: "lstatSync kind",
          call: (m, s) =>
            attempt(() => {
              const st = m.lstatSync(BASE + s);
              return `${st.isFile()}/${st.isDirectory()}/${st.isSymbolicLink()}`;
            }),
        },
        {
          label: "readdirSync",
          call: (m, s) => attempt(() => m.readdirSync(BASE + s).sort().join(",")),
        },
        {
          label: "readFileSync size",
          call: (m, s) => attempt(() => m.readFileSync(BASE + s).length),
        },
        {
          label: "realpathSync tail",
          call: (m, s) => attempt(() => m.realpathSync(BASE + s).split("/").slice(-2).join("/")),
        },
        { label: "accessSync", call: (m, s) => attempt(() => m.accessSync(BASE + s) ?? "void") },

        // **The other 125 published `fs` functions**, compared without writing a
        // byte.
        //
        // The section header's rule -- nothing here creates, moves or removes a
        // file, because a differential that mutates shared state ran against two
        // filesystems -- is what kept the mutating two thirds of this module
        // uncompared. It does not have to. Every one of these functions decides
        // *whether it may act* before it acts, and that decision is a pure
        // function of its arguments.
        //
        // Three invariants make it safe, and each is a property of the arguments
        // rather than a hope about the outcome:
        //
        //   1. Every path lies **two levels** under a directory that does not
        //      exist. `GONE` below is `<base>/no-such-dir-nts/`, so `mkdir`,
        //      `writeFile`, `symlink`, `rename` and the rest reach the syscall and
        //      get `ENOENT` from the missing parent. One level would not do:
        //      `mkdirSync(GONE)` would succeed and create it.
        //   2. Every file descriptor is `2147483647` or `-1`. Never 0, 1 or 2 --
        //      `writeSync(1, ...)` would put bytes on the probe's own stdout and
        //      corrupt the protocol the parent reads its results from, which is a
        //      failure that would look like a divergence.
        //   3. `watchFile` is paired with `unwatchFile` inside the same arm. A
        //      poller holds the loop open, so an unpaired one leaves the child
        //      alive and the parent's `spawnSync` waiting on it forever.
        //
        // The error codes are the comparison and they are worth comparing: this is
        // the layer where `globSync`'s `cwd` validation was found wrong earlier
        // today, by the same method one function over.
        {
          label: "fs-refused-sync",
          call: (m, s) => {
            const GONE = `${BASE}no-such-dir-nts/`;
            const missing = `${GONE}child${s.length % 7}`;
            const second = `${GONE}other${s.length % 5}`;
            // The wrong-type and NUL arms reach the validator; `missing` reaches
            // the syscall. Which of the three a given call gets is chosen by the
            // input, so all three are exercised across the corpus.
            const nul = BASE + s + String.fromCharCode(0);
            // **`REJECTED_NON_NUMERIC`, not `REJECTED`, and both reasons are the
            // kind that only a run finds.**
            //
            // `writeFile` and `appendFile` accept a **file descriptor** where a
            // path goes. `REJECTED` contains `1`, so `writeFileSync(1, "x")` wrote
            // `x` to the probe's own stdout -- the exact hazard invariant 2 above
            // was written for, arriving through the path argument rather than
            // through an fd argument, which is the route that comment did not
            // consider.
            //
            // And `REJECTED` contains `-0`, which **aborts node**:
            // `fs.writeFileSync(-0, "x")` fails a C++ assertion,
            // `(*path) != nullptr` at `node_file.cc:2751`, and the process dies
            // with SIGABRT and a core dump. `-0 === 0` is true, so it passes the fd
            // validation as descriptor 0, and then the path branch finds no path.
            // Every other value in either list answers `ERR_INVALID_ARG_TYPE`.
            //
            // That is node's bug and not a divergence -- this profile's stand-in
            // reaches the same binding and dies identically, which the comparison
            // cannot show because neither side survives to report. It is recorded
            // in `docs/conformance/nodejs.md` and excluded here, because a spec
            // that aborts the process measures nothing.
            //
            // `REJECTED_NON_NUMERIC` holds no numbers at all, and it exists in this
            // file already: `readFileSync!` and `openSync!` above use it, for this
            // same reason, and its name is the record of the first time somebody
            // learned it.
            const bad = REJECTED_NON_NUMERIC[s.length % REJECTED_NON_NUMERIC.length];
            const forms = [missing, nul, bad];
            const pick = (n) => forms[(s.length + n) % forms.length];
            const out = [];
            const ONE_PATH = [
              ["mkdirSync", (p) => m.mkdirSync(p)],
              ["rmdirSync", (p) => m.rmdirSync(p)],
              ["rmSync", (p) => m.rmSync(p)],
              ["unlinkSync", (p) => m.unlinkSync(p)],
              ["truncateSync", (p) => m.truncateSync(p, 0)],
              ["chmodSync", (p) => m.chmodSync(p, 0o644)],
              ["chownSync", (p) => m.chownSync(p, 0, 0)],
              ["lchownSync", (p) => m.lchownSync(p, 0, 0)],
              ["utimesSync", (p) => m.utimesSync(p, 0, 0)],
              ["lutimesSync", (p) => m.lutimesSync(p, 0, 0)],
              ["statfsSync", (p) => m.statfsSync(p)],
              ["readlinkSync", (p) => m.readlinkSync(p)],
              ["writeFileSync", (p) => m.writeFileSync(p, "x")],
              ["appendFileSync", (p) => m.appendFileSync(p, "x")],
              ["mkdtempSync", (p) => m.mkdtempSync(p)],
              ["opendirSync", (p) => m.opendirSync(p)],
            ];
            for (let i = 0; i < ONE_PATH.length; i++) {
              const [name, run] = ONE_PATH[i];
              out.push(`${name}:${attempt(() => run(pick(i)) ?? "void")}`);
            }
            const TWO_PATH = [
              ["renameSync", (a, b) => m.renameSync(a, b)],
              ["copyFileSync", (a, b) => m.copyFileSync(a, b)],
              ["cpSync", (a, b) => m.cpSync(a, b)],
              ["linkSync", (a, b) => m.linkSync(a, b)],
              ["symlinkSync", (a, b) => m.symlinkSync(a, b)],
            ];
            for (let i = 0; i < TWO_PATH.length; i++) {
              const [name, run] = TWO_PATH[i];
              out.push(`${name}:${attempt(() => run(pick(i), second) ?? "void")}`);
            }
            // `mkdtempDisposableSync` answers an object carrying a `remove`, so its
            // success shape differs from a plain path -- but every input here fails,
            // and the code is what is compared.
            out.push(`mkdtempDisposableSync:${attempt(() => m.mkdtempDisposableSync(pick(1)) ?? "void")}`);
            // `_toUnixTimestamp` is the time coercion every `utimes` shares, and it
            // is published. Fed the input's own length so the answer moves.
            //
            // **A negative argument means "now"**, so its answer is the wall clock
            // and not a function of the input. That was the only divergence this
            // whole spec produced on its first run -- `1789437203.7` against
            // `1789437211.058`, seven seconds apart, which is the two processes
            // being started one after the other. What is compared for that arm is
            // the branch it takes: a number, above zero, and not the input.
            //
            // Labelled with `String`, not `JSON.stringify`: the latter renders both
            // `NaN` and `Infinity` as `null`, so two arms printed the same label as
            // the genuine `null` arm and three rows were indistinguishable.
            for (const when of [0, s.length, "1970-01-01", `${s.length}`, NaN, Infinity, -Infinity]) {
              out.push(`_toUnixTimestamp(${String(when)}):${attempt(() => m._toUnixTimestamp(when))}`);
            }
            for (const when of [-1, -s.length - 1]) {
              const answer = attempt(() => {
                const got = m._toUnixTimestamp(when);
                return `${typeof got}|positive:${got > 0}|isInput:${got === when}`;
              });
              out.push(`_toUnixTimestamp(${String(when)}):now:${answer}`);
            }
            return out.join("\n");
          },
        },
        {
          // The same family through its callback form, awaited. A callback error and
          // a synchronous throw are different code paths in every one of these, and
          // node picks between them by *argument validity*: a bad type throws where
          // a missing file calls back.
          label: "fs-refused-async",
          call: async (m, s) => {
            const GONE = `${BASE}no-such-dir-nts/`;
            const missing = `${GONE}child${s.length % 7}`;
            const second = `${GONE}other${s.length % 5}`;
            const settle = (run) => new Promise((resolve) => {
              try {
                run((error, value) => resolve(error ? `cb:${error.code ?? error.name}` : `ok:${value}`));
              } catch (error) {
                resolve(`threw:${error.code ?? error.name}`);
              }
            });
            const out = [];
            const ONE_PATH = [
              ["mkdir", (p, cb) => m.mkdir(p, cb)],
              ["rmdir", (p, cb) => m.rmdir(p, cb)],
              ["rm", (p, cb) => m.rm(p, cb)],
              ["unlink", (p, cb) => m.unlink(p, cb)],
              ["truncate", (p, cb) => m.truncate(p, 0, cb)],
              ["chmod", (p, cb) => m.chmod(p, 0o644, cb)],
              ["chown", (p, cb) => m.chown(p, 0, 0, cb)],
              ["lchown", (p, cb) => m.lchown(p, 0, 0, cb)],
              ["utimes", (p, cb) => m.utimes(p, 0, 0, cb)],
              ["lutimes", (p, cb) => m.lutimes(p, 0, 0, cb)],
              ["statfs", (p, cb) => m.statfs(p, cb)],
              ["writeFile", (p, cb) => m.writeFile(p, "x", cb)],
              ["appendFile", (p, cb) => m.appendFile(p, "x", cb)],
              ["mkdtemp", (p, cb) => m.mkdtemp(p, cb)],
              ["opendir", (p, cb) => m.opendir(p, cb)],
              ["exists", (p, cb) => m.exists(p, (answer) => cb(null, answer))],
            ];
            for (const [name, run] of ONE_PATH) {
              out.push(`${name}:${await settle((cb) => run(missing, cb))}`);
            }
            for (const [name, run] of [
              ["rename", (a, b, cb) => m.rename(a, b, cb)],
              ["copyFile", (a, b, cb) => m.copyFile(a, b, cb)],
              ["cp", (a, b, cb) => m.cp(a, b, cb)],
              ["link", (a, b, cb) => m.link(a, b, cb)],
              ["symlink", (a, b, cb) => m.symlink(a, b, cb)],
            ]) {
              out.push(`${name}:${await settle((cb) => run(missing, second, cb))}`);
            }
            // `glob` over a pattern under a directory that is not there. Read-only
            // whatever the pattern.
            out.push(`glob:${await settle((cb) => m.glob(`${GONE}*.none`, (error, found) => cb(error, JSON.stringify(found))))}`);
            // Wrapped in `Promise.resolve().then`, because `openAsBlob` **throws
            // synchronously** for this path rather than returning a rejected
            // promise -- `ERR_INVALID_ARG_VALUE: Unable to open file as blob`. A
            // bare `.then` on the call never runs, and the throw escaped the spec
            // and failed the whole arm. Which of the two it does is itself worth
            // comparing, so the wrapper records both as `rej:`.
            out.push(`openAsBlob:${await Promise.resolve()
              .then(() => m.openAsBlob(missing))
              .then(() => "ok", (e) => `rej:${e.code ?? e.name}`)}`);
            return out.join("\n");
          },
        },
        {
          // `fs.promises`, which was 25 uncalled names on its own.
          label: "fs-refused-promises",
          call: async (m, s) => {
            const GONE = `${BASE}no-such-dir-nts/`;
            const missing = `${GONE}child${s.length % 7}`;
            const second = `${GONE}other${s.length % 5}`;
            const p = m.promises;
            const settle = (promise) =>
              promise.then((value) => `ok:${value}`, (error) => `rej:${error.code ?? error.name}`);
            const out = [];
            for (const [name, run] of [
              ["mkdir", () => p.mkdir(missing)],
              ["rmdir", () => p.rmdir(missing)],
              ["rm", () => p.rm(missing)],
              ["unlink", () => p.unlink(missing)],
              ["truncate", () => p.truncate(missing, 0)],
              ["chmod", () => p.chmod(missing, 0o644)],
              ["lchmod", () => p.lchmod(missing, 0o644)],
              ["chown", () => p.chown(missing, 0, 0)],
              ["lchown", () => p.lchown(missing, 0, 0)],
              ["utimes", () => p.utimes(missing, 0, 0)],
              ["lutimes", () => p.lutimes(missing, 0, 0)],
              ["statfs", () => p.statfs(missing)],
              ["writeFile", () => p.writeFile(missing, "x")],
              ["appendFile", () => p.appendFile(missing, "x")],
              ["mkdtemp", () => p.mkdtemp(missing)],
              ["mkdtempDisposable", () => p.mkdtempDisposable(missing)],
              ["opendir", () => p.opendir(missing)],
              ["rename", () => p.rename(missing, second)],
              ["copyFile", () => p.copyFile(missing, second)],
              ["cp", () => p.cp(missing, second)],
              ["link", () => p.link(missing, second)],
              ["symlink", () => p.symlink(missing, second)],
            ]) {
              out.push(`${name}:${await settle(Promise.resolve().then(run))}`);
            }
            // `promises.glob` is an async iterable, so it is drained rather than
            // awaited once.
            try {
              const found = [];
              for await (const entry of p.glob(`${GONE}*.none`)) found.push(String(entry));
              out.push(`glob:${JSON.stringify(found)}`);
            } catch (error) {
              out.push(`glob:rej:${error.code ?? error.name}`);
            }
            // `promises.watch` is an async iterable over a path that is not there,
            // so it rejects at once rather than waiting for an event that a poller
            // would have to stay alive for.
            try {
              for await (const event of p.watch(missing)) {
                out.push(`watchEvent:${event && event.eventType}`);
                break;
              }
              out.push("watch:ok");
            } catch (error) {
              out.push(`watch:rej:${error.code ?? error.name}`);
            }
            return out.join("\n");
          },
        },
        {
          // The descriptor family, against a descriptor that cannot be open.
          //
          // `2147483647` and `-1` are the two shapes: the first is a valid `int`
          // that no process has open, so it reaches the syscall and gets `EBADF`;
          // the second fails validation, because node rejects a negative fd before
          // asking the kernel. Which one an arm gets is chosen by the input.
          //
          // Never 0, 1 or 2. `writeSync(1, ...)` would write to the probe's own
          // stdout, and the parent reads its results from there.
          label: "fs-invalid-fd",
          call: (m, s) => {
            const FDS = [2147483647, -1, 2147483646, -2];
            const fd = FDS[s.length % FDS.length];
            const buffer = Buffer.alloc(8);
            const out = [`fd:${fd}`];
            const CALLS = [
              ["fstatSync", () => m.fstatSync(fd)],
              ["fsyncSync", () => m.fsyncSync(fd)],
              ["fdatasyncSync", () => m.fdatasyncSync(fd)],
              ["ftruncateSync", () => m.ftruncateSync(fd, 0)],
              ["fchmodSync", () => m.fchmodSync(fd, 0o644)],
              ["fchownSync", () => m.fchownSync(fd, 0, 0)],
              ["futimesSync", () => m.futimesSync(fd, 0, 0)],
              ["readSync", () => m.readSync(fd, buffer, 0, 4, 0)],
              ["writeSync", () => m.writeSync(fd, buffer, 0, 4, 0)],
              ["writevSync", () => m.writevSync(fd, [buffer], 0)],
              ["readvSync", () => m.readvSync(fd, [buffer], 0)],
              ["closeSync", () => m.closeSync(fd)],
              ["fstatSyncBigInt", () => m.fstatSync(fd, { bigint: true })],
            ];
            for (const [name, run] of CALLS) {
              out.push(`${name}:${attempt(() => run() ?? "void")}`);
            }
            return out.join("\n");
          },
        },
        {
          // The descriptor family's callback and promise halves, same descriptors.
          label: "fs-invalid-fd-async",
          call: async (m, s) => {
            const FDS = [2147483647, -1, 2147483646, -2];
            const fd = FDS[s.length % FDS.length];
            const buffer = Buffer.alloc(8);
            const settle = (run) => new Promise((resolve) => {
              try {
                run((error, value) => resolve(error ? `cb:${error.code ?? error.name}` : `ok:${value}`));
              } catch (error) {
                resolve(`threw:${error.code ?? error.name}`);
              }
            });
            const out = [`fd:${fd}`];
            for (const [name, run] of [
              ["fstat", (cb) => m.fstat(fd, cb)],
              ["fsync", (cb) => m.fsync(fd, cb)],
              ["fdatasync", (cb) => m.fdatasync(fd, cb)],
              ["ftruncate", (cb) => m.ftruncate(fd, 0, cb)],
              ["fchmod", (cb) => m.fchmod(fd, 0o644, cb)],
              ["fchown", (cb) => m.fchown(fd, 0, 0, cb)],
              ["futimes", (cb) => m.futimes(fd, 0, 0, cb)],
              ["read", (cb) => m.read(fd, buffer, 0, 4, 0, cb)],
              ["write", (cb) => m.write(fd, buffer, 0, 4, 0, cb)],
              ["writev", (cb) => m.writev(fd, [buffer], 0, cb)],
              ["readv", (cb) => m.readv(fd, [buffer], 0, cb)],
            ]) {
              out.push(`${name}:${await settle(run)}`);
            }
            return out.join("\n");
          },
        },
        {
          // `Dirent`'s predicates and `Dir`'s iteration, both read-only against the
          // base directory the rest of this section already reads.
          //
          // The predicates are the point: a `Dirent` answers seven of them and
          // exactly one is true, so an implementation that answers `false`
          // everywhere -- or `true` from the wrong one -- is only visible if all
          // seven are asked. The corpus asked none.
          label: "fs-dirent-and-dir",
          call: async (m, s) => {
            const out = [];
            try {
              const entries = m.readdirSync(BASE, { withFileTypes: true })
                .sort((a, b) => (a.name < b.name ? -1 : 1));
              const entry = entries[s.length % Math.max(1, entries.length)];
              if (entry !== undefined) {
                out.push(
                  `dirent:${entry.name}|dir:${entry.isDirectory()}|file:${entry.isFile()}` +
                  `|block:${entry.isBlockDevice()}|char:${entry.isCharacterDevice()}` +
                  `|link:${entry.isSymbolicLink()}|fifo:${entry.isFIFO()}` +
                  `|socket:${entry.isSocket()}`,
                );
                // Exactly one must hold, which no single predicate can show.
                const flags = [entry.isDirectory(), entry.isFile(), entry.isBlockDevice(),
                  entry.isCharacterDevice(), entry.isSymbolicLink(), entry.isFIFO(),
                  entry.isSocket()];
                out.push(`direntTrueCount:${flags.filter(Boolean).length}`);
              }
            } catch (error) {
              out.push(`dirent:${error.code ?? error.name}`);
            }

            // `Dir`: opened, read to exhaustion, closed. Read-only, and it ends, so
            // nothing is left holding the loop.
            try {
              const dir = m.opendirSync(BASE);
              const names = [];
              for (;;) {
                const entry = dir.readSync();
                if (entry === null) break;
                names.push(entry.name);
              }
              out.push(`dirSync:${JSON.stringify(names.sort())}|path:${dir.path === BASE}`);
              dir.closeSync();
            } catch (error) {
              out.push(`dirSync:${error.code ?? error.name}`);
            }
            try {
              const dir = await m.promises.opendir(BASE);
              const names = [];
              for await (const entry of dir) names.push(entry.name);
              out.push(`dirIter:${JSON.stringify(names.sort())}`);
            } catch (error) {
              out.push(`dirIter:${error.code ?? error.name}`);
            }
            try {
              const dir = m.opendirSync(BASE);
              const first = await dir.read();
              out.push(`dirRead:${first === null ? "null" : typeof first.name}`);
              await dir.close();
              out.push(`dirClosed:${attempt(() => dir.readSync() ?? "void")}`);
            } catch (error) {
              out.push(`dirRead:${error.code ?? error.name}`);
            }
            return out.join("\n");
          },
        },
        {
          // The watchers, each released in the arm that starts it.
          //
          // `watch` on a path that is not there throws at once, so it starts
          // nothing. `watchFile` does **not** -- it polls a path whether or not it
          // exists, and a poller holds the loop open, so the `unwatchFile` below is
          // not tidiness. Without it the probe's child stays alive and the parent's
          // `spawnSync` waits on it until the harness timeout, and the tell is a
          // cost that does not grow with the work.
          label: "fs-watchers",
          call: (m, s) => {
            const GONE = `${BASE}no-such-dir-nts/`;
            const missing = `${GONE}child${s.length % 7}`;
            const out = [];
            out.push(`watchMissing:${attempt(() => m.watch(missing) ?? "void")}`);
            try {
              const watcher = m.watchFile(missing, { interval: 5000 }, () => {});
              out.push(`watchFile:${typeof watcher === "object" && watcher !== null}`);
              out.push(`unref:${typeof watcher.unref === "function"}`);
              m.unwatchFile(missing);
              out.push("unwatched:true");
            } catch (error) {
              out.push(`watchFile:${error.code ?? error.name}`);
            }
            // `unwatchFile` on a path nothing watches is a no-op rather than an
            // error, which is the arm that says the pairing above is what stopped
            // the poller and not this call failing.
            out.push(`unwatchUnknown:${attempt(() => m.unwatchFile(`${GONE}never`) ?? "void")}`);
            return out.join("\n");
          },
        },
      ];
    })(),
  },

  assert: {
    // The comparisons and, just as much, the *messages*. `deepStrictEqual`'s
    // failure text is a diff produced by `inspect`, and it is the part a person
    // reads -- an implementation can decide the same comparisons correctly and
    // still print something else entirely.
    //
    // The input is a small program describing a structure, and the pair is that
    // structure against a perturbation of it, so most pairs differ somewhere and
    // the message is exercised rather than the fast path.
    fixed: [
      "n", "s", "a", "o", "d", "u", "l", "b", "g", "m", "e", "t",
      "aa", "oo", "ao", "oa", "nn", "ss", "aaa", "ooo", "ml", "gt", "eu",
    ],
    input: (rnd) => {
      const K = "nsaodulbgmet";
      let out = "";
      const k = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < k; i++) out += K[Math.floor(rnd() * K.length)];
      return out;
    },
    calls: (() => {
      // Both sides build the structures identically; only the module differs.
      const build = (program, tweak) => {
        let node = tweak ? 1 : 0;
        const make = (i) => {
          if (i >= program.length) return tweak ? "end*" : "end";
          const rest = make(i + 1);
          switch (program[i]) {
            case "n": return node++;
            case "s": return `s${rest}`;
            case "a": return [rest, node];
            case "o": return { k: rest, n: node };
            case "d": return new Date(0);
            case "u": return undefined;
            case "l": return null;
            case "b": return tweak ? false : true;
            case "g": return BigInt(node);
            case "m": return new Map([["k", rest]]);
            case "e": return new Set([rest]);
            case "t": return new Uint8Array([node % 256]);
            default: return rest;
          }
        };
        return make(0);
      };
      const attempt = (fn) => {
        try {
          fn();
          return "ok";
        } catch (error) {
          return `${error.name}|${error.code}|${error.message}`;
        }
      };
      return [
        {
          // **The rest of `assert`'s published surface**, which was 29 of 43. What was uncalled:
          // `notDeepEqual`, the two async assertions, the `strict` namespace, `CallTracker` in
          // full, `AssertionError#toString`, and the `Assert` class. All of it is a value or a
          // thrown code, and the async pair was out of reach only because the harness could not
          // await.
          //
          // `CallTracker` is deprecated upstream and still published: `calls` wraps a function and
          // `report`/`verify` answer about what was actually invoked. Its state is per-tracker and
          // a fresh one is built per input, so unlike `console.count` nothing leaks between them.
          label: "surface-remainder",
          call: async (m, s) => {
            const structure = build(s, false);
            const tweaked = build(s, true);
            const attempt = (make) => {
              try {
                const v = make();
                return v === undefined ? "ok" : String(v);
              } catch (error) {
                return `${error?.code ?? error?.name ?? "?"}`;
              }
            };
            const settle = async (make) => {
              try { await make(); return "ok"; } catch (error) { return `${error?.code ?? error?.name ?? "?"}`; }
            };
            return [
              // `notDeepEqual` is the negation and has its own answer on the tweaked pair.
              attempt(() => m.notDeepEqual(structure, tweaked)),
              attempt(() => m.notDeepEqual(structure, structure)),
              // The `strict` namespace is the same relations with `deepStrictEqual` semantics.
              attempt(() => (m.strict === undefined ? "absent" : m.strict.deepEqual(structure, structure))),
              attempt(() => (m.strict === undefined ? "absent" : m.strict.notDeepEqual(structure, tweaked))),
              // The async pair: a promise that rejects, and one that does not.
              await settle(() => m.rejects(Promise.reject(new TypeError(String(s))), TypeError)),
              await settle(() => m.rejects(Promise.resolve("no"), TypeError)),
              await settle(() => m.doesNotReject(Promise.resolve("fine"))),
              await settle(() => m.doesNotReject(Promise.reject(new Error("boom")))),
              // `AssertionError`'s own rendering, which a caller sees in a log.
              attempt(() => {
                const error = new m.AssertionError({ message: `m:${s}`, actual: 1, expected: 2, operator: "==" });
                return `${error.toString()}|${error.code}|${error.operator}`;
              }),
              // `CallTracker`: a wrapped function called the wrong number of times must be
              // reported, and `verify` must throw about it.
              attempt(() => {
                if (m.CallTracker === undefined) return "absent";
                const tracker = new m.CallTracker();
                const once = tracker.calls(() => "called", 1);
                const twice = tracker.calls(() => "called", 2);
                once();
                twice();
                const report = tracker.report();
                const shape = report.map((r) => `${r.actual}/${r.expected}`).sort().join(",");
                const calls = typeof tracker.getCalls === "function"
                  ? tracker.getCalls(twice).length
                  : "no-getCalls";
                const verified = (() => {
                  try { tracker.verify(); return "verified"; } catch (error) { return error.code ?? error.name; }
                })();
                tracker.reset();
                return `${shape}|${calls}|${verified}|after-reset:${tracker.report().length}`;
              }),
            ].join("|");
          },
        },
        // Error paths. See `REJECTED` above.
        { label: "strictEqual!", throws: true, call: (m, s) => m.strictEqual(s, rejected(s)) },
        { label: "deepStrictEqual!", throws: true, call: (m, s) => m.deepStrictEqual({ a: s }, { a: rejected(s) }) },
        {
          label: "deepStrictEqual(a,b)",
          call: (m, p) => attempt(() => m.deepStrictEqual(build(p, false), build(p, true))),
        },
        {
          label: "deepStrictEqual(a,a)",
          call: (m, p) => attempt(() => m.deepStrictEqual(build(p, false), build(p, false))),
        },
        {
          label: "notDeepStrictEqual(a,a)",
          call: (m, p) => attempt(() => m.notDeepStrictEqual(build(p, false), build(p, false))),
        },
        {
          label: "deepEqual(a,b)",
          call: (m, p) => attempt(() => m.deepEqual(build(p, false), build(p, true))),
        },
        {
          label: "strictEqual(a,b)",
          call: (m, p) => attempt(() => m.strictEqual(build(p, false), build(p, true))),
        },
        {
          // **The assertions that are not deep comparisons.** `deepEqual`,
          // `deepStrictEqual` and `isDeepStrictEqual` are `fuzz-deep-equal.mjs`'s
          // subject and are deliberately not repeated here -- that file builds
          // structures a string corpus cannot, and duplicating it would add
          // comparisons without adding coverage.
          //
          // What nothing owned: `ok`, `fail`, `equal`, `notEqual`, `match`,
          // `doesNotMatch`, `ifError` and `partialDeepStrictEqual`. Each is
          // compared by **what it throws**, since a passing assertion returns
          // `undefined` and says nothing -- the error's `code` and the operator in
          // its message are the observable part, and the operator is what tells
          // `equal` from `strictEqual` in a failure a program prints.
          //
          // The loose pair is given `"1"` against `1` and `""` against `0`, which
          // is where `==` and `===` part company and where a reimplementation that
          // routes both through one comparison stops being distinguishable.
          label: "assertions",
          call: (m, s) => {
            const show = (f) => {
              try {
                f();
                return "ok";
              } catch (error) {
                const code = (error && error.code) || (error && error.name) || "?";
                const op = error && error.operator !== undefined ? String(error.operator) : "-";
                return `${code}/${op}`;
              }
            };
            const re = new RegExp(s.length % 2 === 0 ? "^a" : "^b");
            return [
              show(() => m.ok(s.length)),
              show(() => m.ok(s.length === 0 ? 0 : 1)),
              show(() => m.ok("")),
              show(() => m.fail(s)),
              show(() => m.equal("1", 1)),
              show(() => m.equal("", 0)),
              show(() => m.equal(s, s)),
              show(() => m.notEqual("1", 1)),
              show(() => m.notEqual(s, `${s}x`)),
              show(() => m.strictEqual("1", 1)),
              show(() => m.strictEqual(s, s)),
              show(() => m.notStrictEqual("1", 1)),
              show(() => m.match(s, re)),
              show(() => m.doesNotMatch(s, re)),
              show(() => m.ifError(null)),
              show(() => m.ifError(undefined)),
              show(() => m.ifError(s.length === 0 ? null : new Error(s))),
              show(() => m.partialDeepStrictEqual({ a: 1, b: s }, { a: 1 })),
              show(() => m.partialDeepStrictEqual({ a: 1 }, { a: 1, b: s })),
              show(() => m.throws(() => { throw new TypeError(s); }, TypeError)),
              show(() => m.throws(() => s, TypeError)),
              show(() => m.doesNotThrow(() => s)),
              show(() => m.doesNotThrow(() => { throw new TypeError(s); })),
            ].join("|");
          },
        },
      ];
    })(),
  },

  buffer: {
    // Encoding round trips, which is where a byte-level implementation
    // diverges if it is going to: base64 padding, hex casing, latin1 above
    // 0x7f, utf16le on an odd length, and what a lone surrogate becomes.
    fixed: [
      "", "a", "ab", "abc", "abcd", "\u0000", "ÿ", "€", "😀", "\uD800",
      "\uDC00", "a\uD800b", "ü".repeat(40), "=", "==", "===", "AA", "AAA",
      "AAAA", "A===", "+/", "-_", "\n", "a\nb", "0123456789abcdef",
    ],
    input: (rnd) => unicodeWord(rnd),
    calls: [
      {
        // **The per-encoding slice and write methods, and `Blob`.** `corpus-reach.mjs` had this
        // module at 94 of 117 and the remainder was these: `Buffer#utf8Slice` and its eight
        // siblings, `Buffer#hexWrite` and its eight, `Buffer#inspect`, `SlowBuffer`, and the
        // `Blob` surface -- which is asynchronous and so was out of reach until the harness
        // learned to await.
        //
        // The `*Slice`/`*Write` pair is what `toString(encoding)` and `write(string, encoding)`
        // are built on, published and undocumented. They take raw offsets with no validation, so
        // they are exactly where an off-by-one lives, and nothing in the pinned suite calls one.
        label: "encoding-primitives",
        call: async (m, s) => {
          const bytes = m.Buffer.from(s, "utf8");
          const show = (make) => {
            try {
              const v = make();
              if (v instanceof Uint8Array) return m.Buffer.from(v).toString("base64");
              return String(v);
            } catch (error) {
              return `threw:${error?.code ?? error?.name ?? "?"}`;
            }
          };
          const slices = ["utf8Slice", "asciiSlice", "latin1Slice", "hexSlice", "base64Slice",
            "base64urlSlice", "ucs2Slice"];
          const written = (method) => show(() => {
            const into = m.Buffer.alloc(16);
            const n = into[method](s, 0, 16);
            return `${n}:${into.toString("hex")}`;
          });
          const settle = async (make) => {
            try { return `ok:${await make()}`; } catch (error) { return `${error?.code ?? error?.name ?? "?"}`; }
          };
          return [
            // Each slice over the whole buffer, and one over an interior range so an offset that
            // is quietly ignored shows up.
            ...slices.map((method) => (typeof bytes[method] === "function"
              ? `${method}=${show(() => bytes[method](0, bytes.length))}`
              : `${method}=absent`)),
            ...slices.map((method) => (typeof bytes[method] === "function"
              ? `${method}[1,3]=${show(() => bytes[method](1, 3))}`
              : `${method}=absent`)),
            ...["utf8Write", "asciiWrite", "latin1Write", "hexWrite", "base64Write",
              "base64urlWrite", "ucs2Write"].map((method) => (
              typeof m.Buffer.prototype[method] === "function"
                ? `${method}=${written(method)}`
                : `${method}=absent`)),
            `inspect=${show(() => bytes.inspect())}`,
            `slow=${typeof m.SlowBuffer === "function" ? show(() => m.SlowBuffer(s.length).length) : "absent"}`,
            // `Blob` is a value with asynchronous readers: the bytes it gives back, its size and
            // type, and what a slice of it contains.
            await settle(async () => {
              if (m.Blob === undefined) return "absent";
              const blob = new m.Blob([s, bytes], { type: "text/plain" });
              const sliced = blob.slice(0, Math.min(3, blob.size));
              return [
                blob.size,
                blob.type,
                (await blob.text()).length,
                m.Buffer.from(await blob.arrayBuffer()).toString("base64"),
                typeof blob.bytes === "function"
                  ? m.Buffer.from(await blob.bytes()).toString("base64")
                  : "no-bytes",
                await sliced.text(),
              ].join(",");
            }),
            // An object URL that was never registered resolves to `undefined` on both sides.
            `resolve=${show(() => (m.resolveObjectURL === undefined
              ? "absent"
              : String(m.resolveObjectURL(`blob:nodedata:${s.slice(0, 8)}`))))}`,
          ].join("|");
        },
      },
      {
        // **`Buffer`'s instance methods**, which were the largest single gap in
        // the corpus: 18 of 117 reached, and the 99 unreached include every
        // numeric accessor. Endianness, sign extension and the unaligned offset
        // are exactly where a byte-level reimplementation goes wrong, and they
        // are trivially comparable -- a buffer in, a number out.
        //
        // Every accessor is called at offset 0 **and** at offset 1, because an
        // implementation that reads through a `DataView` and one that assembles
        // bytes by hand agree on aligned reads and can differ on unaligned ones.
        //
        // Out-of-range offsets are included rather than avoided: `ERR_OUT_OF_RANGE`
        // against `ERR_BUFFER_OUT_OF_BOUNDS` is a distinction node makes and one a
        // reimplementation collapses, and the code is compared.
        label: "buffer-accessors",
        call: (m, s) => {
          const base = m.Buffer.alloc(16);
          m.Buffer.from(s, "utf8").copy(base, 0, 0, Math.min(16, m.Buffer.byteLength(s, "utf8")));
          const show = (f) => {
            try {
              const v = f();
              if (v instanceof Uint8Array) return `<${[...v].join(" ")}>`;
              return typeof v === "bigint" ? `${v}n` : String(v);
            } catch (error) {
              return `threw:${(error && error.code) || (error && error.name) || "?"}`;
            }
          };
          const reads = [
            "readUInt8", "readUInt16LE", "readUInt16BE", "readUInt32LE", "readUInt32BE",
            "readInt8", "readInt16LE", "readInt16BE", "readInt32LE", "readInt32BE",
            "readFloatLE", "readFloatBE", "readDoubleLE", "readDoubleBE",
            "readBigInt64LE", "readBigInt64BE", "readBigUInt64LE", "readBigUInt64BE",
          ];
          const out = [];
          for (const name of reads) {
            out.push(show(() => base[name](0)));
            out.push(show(() => base[name](1)));
            out.push(show(() => base[name](15)));
          }
          for (const name of ["readUIntLE", "readUIntBE", "readIntLE", "readIntBE"]) {
            for (const width of [1, 3, 6, 7]) out.push(show(() => base[name](0, width)));
          }
          const writes = [
            ["writeUInt8", 0xff], ["writeUInt16LE", 0xfffe], ["writeUInt16BE", 0xfffe],
            ["writeUInt32LE", 0xfffffffe], ["writeUInt32BE", 0xfffffffe],
            ["writeInt8", -2], ["writeInt16LE", -2], ["writeInt16BE", -2],
            ["writeInt32LE", -2], ["writeInt32BE", -2],
            ["writeFloatLE", 1.5], ["writeFloatBE", 1.5],
            ["writeDoubleLE", -1.25], ["writeDoubleBE", -1.25],
            ["writeBigInt64LE", -2n], ["writeBigInt64BE", -2n],
            ["writeBigUInt64LE", 2n ** 63n], ["writeBigUInt64BE", 2n ** 63n],
          ];
          for (const [name, value] of writes) {
            out.push(show(() => {
              const t = m.Buffer.alloc(16);
              const at = t[name](value, 1);
              return `${at}:${[...t].join(" ")}`;
            }));
          }
          for (const name of ["writeUIntLE", "writeUIntBE", "writeIntLE", "writeIntBE"]) {
            for (const width of [1, 3, 6]) {
              out.push(show(() => {
                const t = m.Buffer.alloc(16);
                const at = t[name](name.includes("Int") && !name.includes("UInt") ? -3 : 3, 0, width);
                return `${at}:${[...t].join(" ")}`;
              }));
            }
          }
          const other = m.Buffer.from(`${s}z`, "utf8");
          out.push(show(() => base.equals(base)));
          out.push(show(() => base.equals(other)));
          out.push(show(() => base.compare(other)));
          out.push(show(() => base.compare(other, 0, 4, 0, 4)));
          out.push(show(() => base.indexOf(other)));
          out.push(show(() => base.indexOf(0)));
          out.push(show(() => base.lastIndexOf(0)));
          out.push(show(() => base.includes(0)));
          out.push(show(() => base.toJSON().data.length));
          out.push(show(() => base.subarray(2, 6)));
          out.push(show(() => base.slice(2, 6)));
          out.push(show(() => m.Buffer.from(base).fill(0x41, 2, 6)));
          out.push(show(() => m.Buffer.from(base).fill(s, 0, 8)));
          out.push(show(() => {
            const t = m.Buffer.alloc(8);
            const n = t.write(s, 1, "utf8");
            return `${n}:${[...t].join(" ")}`;
          }));
          out.push(show(() => m.Buffer.from(base).swap16()));
          out.push(show(() => m.Buffer.from(base).swap32()));
          out.push(show(() => m.Buffer.from(base).swap64()));
          return out.join("|");
        },
      },
      {
        // **`Buffer`'s statics**, which the corpus never called: `alloc`,
        // `concat`, `compare`, `isBuffer`, `isEncoding`, `of`, `copyBytesFrom`,
        // and the free functions `isUtf8`, `isAscii` and `transcode`. Ten of the
        // fourteen `corpus-reach.mjs` reported unreached in this module, and all
        // ten are pure.
        //
        // `allocUnsafe` is here for its **length only**. Its contents are
        // whatever the allocator last left there, so comparing them would report
        // a divergence on every input and say nothing -- the one thing about it
        // that is specified is how much memory you get.
        //
        // `concat` is given a `totalLength` that is deliberately wrong in both
        // directions as well as absent, because truncating and zero-padding are
        // the two behaviours a reimplementation gets backwards.
        label: "buffer-statics",
        call: (m, s) => {
          const B = m.Buffer;
          const bytes = [...s].map((c) => c.charCodeAt(0) & 0xff);
          const a = B.from(s, "utf8");
          const b = B.from(bytes);
          const show = (f) => {
            try {
              const v = f();
              if (v instanceof Uint8Array) return `<${[...v].join(" ")}>`;
              return String(v);
            } catch (error) {
              return `threw:${(error && error.code) || (error && error.name) || "?"}`;
            }
          };
          return [
            show(() => B.alloc(bytes.length)),
            show(() => B.alloc(bytes.length, 0x41)),
            show(() => B.alloc(bytes.length, s, "utf8")),
            show(() => B.allocUnsafe(bytes.length).length),
            show(() => B.allocUnsafeSlow(bytes.length).length),
            show(() => B.of(...bytes.slice(0, 4))),
            show(() => B.isBuffer(a)),
            show(() => B.isBuffer(bytes)),
            show(() => B.isEncoding(s)),
            show(() => B.isEncoding("utf8")),
            show(() => B.compare(a, b)),
            show(() => B.compare(a, a)),
            show(() => B.concat([a, b])),
            show(() => B.concat([a, b], 0)),
            show(() => B.concat([a, b], a.length + b.length + 3)),
            show(() => B.concat([], 2)),
            show(() => B.copyBytesFrom(Uint8Array.from(bytes))),
            show(() => m.isUtf8(a)),
            show(() => m.isAscii(a)),
            show(() => m.transcode(a, "utf8", "latin1")),
          ].join("|");
        },
      },
      {
        // **The array-like path**, which every spec here reached past: they all
        // hand `Buffer.from` a string, and the object arm is a different function
        // entirely. Node accepts three storage shapes behind one contract -- a
        // real array, a typed array, and any object with a `length` -- and the
        // last of those was checked by hand on 2026-09-10 and then had nothing
        // holding it.
        //
        // Eight shapes per input, including the ones that decide the edges: a
        // non-number `length` yields an empty buffer, a negative one likewise, a
        // fractional one truncates, and a missing index reads as 0 rather than
        // being skipped. The null-prototype object is here because a
        // representation keyed off the prototype would pass every other row.
        label: "from(array-like)",
        call: (m, s) => {
          const codes = [...s].map((c) => c.charCodeAt(0) & 0xff);
          const indexed = (base) => {
            for (let i = 0; i < codes.length; i++) base[i] = codes[i];
            return base;
          };
          const show = (v) => {
            try {
              return `<${[...m.Buffer.from(v)].join(" ")}>`;
            } catch (error) {
              return `threw:${(error && error.code) || (error && error.name) || "?"}`;
            }
          };
          const bare = Object.create(null);
          bare.length = codes.length;
          for (let i = 0; i < codes.length; i++) bare[i] = codes[i];
          return [
            show(codes),
            show(Uint8Array.from(codes)),
            show(indexed({ length: codes.length })),
            show(bare),
            show(indexed({ length: String(codes.length) })),
            show(indexed({ length: codes.length - 0.3 })),
            show({ length: codes.length }),
            show({ length: -codes.length, 0: 65 }),
          ].join("|");
        },
      },
      { name: "atob", args: (s) => [s] },
      { name: "btoa", args: (s) => [s] },
      ...["utf8", "utf16le", "latin1", "base64", "base64url", "hex", "ascii", "binary", "ucs2"]
        .flatMap((enc) => [
          {
            label: `from(${enc}).toString(${enc})`,
            call: (m, s) => m.Buffer.from(s, enc).toString(enc),
          },
          {
            label: `from(utf8).toString(${enc})`,
            call: (m, s) => m.Buffer.from(s, "utf8").toString(enc),
          },
          {
            label: `byteLength(${enc})`,
            call: (m, s) => m.Buffer.byteLength(s, enc),
          },
        ]),
    ],
  },

  events: {
    // A state-machine fuzz rather than a value fuzz. The input is a *program*
    // over an EventEmitter -- each character is an operation -- and the result
    // is the log it produces. EventEmitter's subtleties are all sequencing:
    // a `once` that fires during an emit it was added in, a listener removed
    // while the same emit is walking the list, `prependListener` against
    // registration order, and what `listenerCount` says in the middle of it.
    //
    // Comparing a value would not reach any of that. There is no input to
    // `emit` that makes removal-during-emit happen; only an order of calls
    // does.
    fixed: [
      "oe", "ne", "nee", "oe", "ope", "onpe", "oree", "oaee", "ooee", "nnee",
      "orea", "opnre", "oo", "e", "", "onpeeree", "nre", "opre", "aoe", "ocec",
    ],
    input: (rnd) => {
      const OPS = "onpercab";
      let out = "";
      const k = 1 + Math.floor(rnd() * 10);
      for (let i = 0; i < k; i++) out += OPS[Math.floor(rnd() * OPS.length)];
      return out;
    },
    calls: [
      {
        // **`events.once` and `events.on`, the promise and async-iterator halves.**
        //
        // `corpus-reach.mjs` had this module at 22 of 34 published functions, and these two were
        // among the missing: both answer with a promise, and until `differential-ts.mjs` and its
        // probe learned to await, a spec could not hold one.
        //
        // Deterministic despite being asynchronous, because the emits are scheduled before the
        // await and the order of a single emitter's listeners is defined. No timers are involved,
        // so this is a value compare and not the ordering question `fuzz-timer-order.mjs` owns.
        label: "once-and-on",
        call: async (m, s) => {
          const payload = Array.from(s).map((c) => c.charCodeAt(0));
          const show = async (make) => {
            try {
              const v = await make();
              return `ok:${Array.isArray(v) ? v.join(",") : String(v)}`;
            } catch (error) {
              return `${error.code ?? error.name ?? "?"}`;
            }
          };
          return [
            // `once` resolves with the whole argument list, which is the part a naive
            // implementation gets wrong by resolving with the first argument only.
            await show(() => {
              const emitter = new m.EventEmitter();
              queueMicrotask(() => emitter.emit("go", ...payload));
              return m.once(emitter, "go");
            }),
            // and rejects on `error`, with the error itself rather than a wrapper.
            await show(() => {
              const emitter = new m.EventEmitter();
              queueMicrotask(() => emitter.emit("error", new Error("boom")));
              return m.once(emitter, "go");
            }),
            // `on` is an async iterator over every emit until the iterator is closed.
            await show(async () => {
              if (m.on === undefined) return "absent";
              const emitter = new m.EventEmitter();
              const iterator = m.on(emitter, "tick");
              queueMicrotask(() => {
                for (const value of payload) emitter.emit("tick", value);
                emitter.emit("tick", null);
              });
              const seen = [];
              for await (const [value] of iterator) {
                if (value === null) break;
                seen.push(value);
              }
              return seen;
            }),
            // The listener bookkeeping these two rest on, which is synchronous and is where a
            // leak would show: `once` must not leave its listener behind on either path.
            await show(async () => {
              const emitter = new m.EventEmitter();
              queueMicrotask(() => emitter.emit("go", 1));
              await m.once(emitter, "go");
              return `${emitter.listenerCount("go")}/${emitter.listenerCount("error")}`;
            }),
            await show(async () => {
              const emitter = new m.EventEmitter();
              emitter.prependOnceListener("x", () => {});
              emitter.on("x", () => {});
              return `${emitter.listenerCount("x")}/${emitter.getMaxListeners()}`;
            }),
          ].join("|");
        },
      },

      {
        // **The module-level helpers**, which the corpus never called:
        // `listenerCount`, `getEventListeners`, `getMaxListeners`. They answer
        // *about* an emitter rather than driving one, so the program specs never
        // touch them however long the program is.
        //
        // Driven by the same program alphabet so the emitter under inspection has
        // a real history: asking `listenerCount` of a fresh emitter compares 0
        // against 0 forever.
        //
        // `getEventListeners` returns the listener array, and the two lanes hold
        // different function objects -- so its length is compared and its contents
        // are not, the same rule the meta-event spec uses.
        label: "emitter-helpers",
        call: (m, program) => {
          const emitter = new m.EventEmitter();
          const log = [];
          const made = [];
          let n = 0;
          for (const op of program) {
            n++;
            const fn = () => n;
            try {
              if (op === "o") { made.push(fn); emitter.on("x", fn); }
              else if (op === "n") { made.push(fn); emitter.once("x", fn); }
              else if (op === "p") { made.push(fn); emitter.prependListener("y", fn); }
              else if (op === "e") emitter.emit("x");
              else if (op === "r") { if (made.length > 0) emitter.removeListener("x", made.shift()); }
              else if (op === "a") emitter.removeAllListeners("x");
              else if (op === "c") {
                log.push(`mc=${m.listenerCount(emitter, "x")}`);
                log.push(`gel=${m.getEventListeners(emitter, "x").length}`);
              } else if (op === "b") {
                log.push(`gml=${m.getMaxListeners(emitter)}`);
                log.push(`dml=${m.EventEmitter.defaultMaxListeners}`);
              }
            } catch (error) {
              log.push(`threw=${(error && error.code) || error.name}`);
            }
          }
          // Every helper once at the end, so a program with no `c` or `b` still
          // exercises them against whatever state it left behind.
          const tail = (f) => {
            try {
              return String(f());
            } catch (error) {
              return `threw:${(error && error.code) || error.name}`;
            }
          };
          return [
            log.join(","),
            `final-mc=${tail(() => m.listenerCount(emitter, "x"))}`,
            `final-y=${tail(() => m.listenerCount(emitter, "y"))}`,
            `final-gel=${tail(() => m.getEventListeners(emitter, "x").length)}`,
            `final-gml=${tail(() => m.getMaxListeners(emitter))}`,
            `raw=${tail(() => emitter.rawListeners("x").length)}`,
            `names=${tail(() => emitter.eventNames().map(String).join("+"))}`,
          ].join("|");
        },
      },
      // Error paths. See `REJECTED` above.
      { label: "setMaxListeners!", throws: true, call: (m, s) => m.setMaxListeners(-(String(s).length + 1)) },
      // `rejectedNonNumeric`: `setMaxListeners(1)` is a perfectly good call, so the
      // general table made this succeed and the harness compared the two returned
      // emitters instead -- 1,547 divergences that were nothing to do with errors.
      // They were a real finding, but not this spec's.
      { label: "ee.setMaxListeners!", throws: true, call: (m, s) => new m.EventEmitter().setMaxListeners(rejectedNonNumeric(s)) },
      {
        label: "emitter-program",
        call: (m, program) => {
          const emitter = new m.EventEmitter();
          const log = [];
          const made = [];
          const listener = (tag) => {
            const fn = () => log.push(tag);
            made.push(fn);
            return fn;
          };
          let n = 0;
          for (const op of program) {
            n++;
            try {
              if (op === "o") emitter.on("x", listener(`on${n}`));
              else if (op === "n") emitter.once("x", listener(`once${n}`));
              else if (op === "p") emitter.prependListener("x", listener(`pre${n}`));
              else if (op === "e") log.push(`emit=${emitter.emit("x")}`);
              else if (op === "r") {
                if (made.length > 0) emitter.removeListener("x", made[0]);
              } else if (op === "c") log.push(`count=${emitter.listenerCount("x")}`);
              else if (op === "a") emitter.removeAllListeners("x");
              else if (op === "b") log.push(`names=${emitter.eventNames().join("+")}`);
            } catch (error) {
              log.push(`threw=${error.name}`);
            }
          }
          return log.join(",") + `|final=${emitter.listenerCount("x")}`;
        },
      },
      {
        // **Receiver identity and argument forwarding**, which the program spec
        // above cannot see: it logs a tag and nothing about how the listener was
        // called. Node calls a listener with the emitter as `this` -- including a
        // `once` listener, after it has been removed -- and forwards `emit`'s
        // arguments exactly. All three can be subtly wrong while every ordering
        // test passes.
        //
        // A plain `function`, not an arrow, because an arrow has no `this` of its
        // own and would make the check vacuous.
        label: "emitter-receiver",
        call: (m, program) => {
          const emitter = new m.EventEmitter();
          const log = [];
          const made = [];
          const listener = (tag) => {
            const fn = function (...args) {
              log.push(`${tag}:this=${this === emitter}:argc=${args.length}:${args.join("~")}`);
            };
            made.push(fn);
            return fn;
          };
          let n = 0;
          for (const op of program) {
            n++;
            try {
              if (op === "o") emitter.on("x", listener(`on${n}`));
              else if (op === "n") emitter.once("x", listener(`once${n}`));
              else if (op === "p") emitter.prependListener("x", listener(`pre${n}`));
              else if (op === "e") log.push(`emit=${emitter.emit("x", n, "s", undefined)}`);
              else if (op === "r") {
                if (made.length > 0) emitter.removeListener("x", made[0]);
              } else if (op === "c") log.push(`count=${emitter.listenerCount("x")}`);
              else if (op === "a") emitter.removeAllListeners("x");
              else if (op === "b") log.push(`max=${emitter.getMaxListeners()}`);
            } catch (error) {
              log.push(`threw=${error.name}`);
            }
          }
          return log.join(",");
        },
      },
      {
        // The meta-events, which node emits around every registration and removal:
        // `newListener` **before** the listener is added, so a handler asking
        // `listenerCount` sees the old count, and `removeListener` after. Their
        // order relative to each other and to the operation is the contract, and
        // nothing else here touches them.
        //
        // The listener argument is reported as `typeof` rather than stringified:
        // the two lanes hold different function objects, and printing them would
        // compare source text -- a non-goal, and it would diverge on every input.
        label: "emitter-meta",
        call: (m, program) => {
          const emitter = new m.EventEmitter();
          const log = [];
          const made = [];
          emitter.on("newListener", function (name, fn) {
            log.push(`new:${String(name)}:${typeof fn}:this=${this === emitter}:count=${emitter.listenerCount("x")}`);
          });
          emitter.on("removeListener", function (name, fn) {
            log.push(`rm:${String(name)}:${typeof fn}:this=${this === emitter}:count=${emitter.listenerCount("x")}`);
          });
          let n = 0;
          for (const op of program) {
            n++;
            const fn = () => log.push(`fired${n}`);
            try {
              if (op === "o") { made.push(fn); emitter.on("x", fn); }
              else if (op === "n") { made.push(fn); emitter.once("x", fn); }
              else if (op === "p") { made.push(fn); emitter.prependListener("x", fn); }
              else if (op === "e") log.push(`emit=${emitter.emit("x")}`);
              else if (op === "r") { if (made.length > 0) emitter.removeListener("x", made.shift()); }
              else if (op === "a") emitter.removeAllListeners("x");
              else if (op === "c") log.push(`count=${emitter.listenerCount("x")}`);
              else if (op === "b") log.push(`names=${emitter.eventNames().map(String).join("+")}`);
            } catch (error) {
              log.push(`threw=${error.name}`);
            }
          }
          return log.join(",");
        },
      },
      {
        label: "remove-during-emit",
        call: (m, program) => {
          const emitter = new m.EventEmitter();
          const log = [];
          // A listener that removes another one while the emit is in flight,
          // which is where implementations disagree about whether the list was
          // copied.
          const b = () => log.push("b");
          const a = () => {
            log.push("a");
            emitter.removeListener("x", b);
          };
          emitter.on("x", a);
          emitter.on("x", b);
          for (const op of program) {
            if (op === "e") log.push(`emit=${emitter.emit("x")}`);
            else if (op === "o") emitter.on("x", b);
          }
          return log.join(",") + `|final=${emitter.listenerCount("x")}`;
        },
      },
    ],
  },

  util: {
    // `format`'s specifiers, where the input is the *template* rather than the
    // value. The rules are fiddly and positional: a specifier consumes the next
    // argument, an unmatched one is left alone, `%%` is a literal, and leftover
    // arguments are appended with a space and inspected rather than stringified.
    fixed: [
      "", "%s", "%d", "%i", "%f", "%j", "%o", "%O", "%c", "%%", "%",
      "%s%s", "%s %s %s %s %s", "%z", "%%s", "%s%%", "a%sb%dc",
      "%j", "%o %O", "%d%i%f", "%s%", "%", "%%%%", "no specifiers at all",
    ],
    input: (rnd) => {
      const TOK = ["%s", "%d", "%i", "%f", "%j", "%o", "%O", "%c", "%%", "%",
        "%z", "a", " ", "ü", "日", "{}", "[]", "\n"];
      let out = "";
      const k = 1 + Math.floor(rnd() * 6);
      for (let i = 0; i < k; i++) out += choose(rnd, TOK);
      return out;
    },
    calls: [
      {
        // **The pure helpers outside `types`**, which nothing called:
        // `getSystemErrorName`, `getSystemErrorMessage`, `getSystemErrorMap`,
        // `isArray`, `styleText`, `parseArgs`, `parseEnv` and `diff`.
        //
        // Eight names are **deliberately not here**, and they are the ones this
        // profile does not publish at all: `_extend`, `getCallSites`, `inherits`,
        // `transferableAbortSignal`, `transferableAbortController`, `MIMEType`,
        // `MIMEParams`, `setTraceSigInt`. Calling them would report one
        // divergence per input for a known absence, which is the same mistake as
        // letting the eight refused `types` predicates run: a recorded gap
        // drowning out everything else in the spec.
        //
        // `styleText` is given a colour and `"none"`, because the interesting
        // case is not the escape codes -- it is whether the module decides to
        // emit them at all, which depends on stream detection and is where two
        // implementations disagree while both "work".
        label: "util-helpers",
        call: (m, s) => {
          const show = (f) => {
            try {
              const v = f();
              return v === undefined ? "undefined" : String(v);
            } catch (error) {
              return `threw:${(error && error.code) || (error && error.name) || "?"}`;
            }
          };
          const errno = -(1 + (s.length % 40));
          return [
            show(() => m.getSystemErrorName(errno)),
            show(() => m.getSystemErrorMessage(errno)),
            show(() => m.getSystemErrorMap().size),
            show(() => {
              const entry = m.getSystemErrorMap().get(errno);
              return Array.isArray(entry) ? entry.join(",") : String(entry);
            }),
            show(() => m.isArray([s])),
            show(() => m.isArray(s)),
            // `validateStream: false`, because without it `styleText` emits
            // nothing when stdout is not a TTY -- which it never is under the
            // harness. The first version compared the input against itself on
            // both sides and could not fail: a control that replaced `styleText`
            // with the identity function was noticed on **0 of 20** inputs.
            show(() => m.styleText("red", s, { validateStream: false })),
            show(() => m.styleText(["red", "bold"], s, { validateStream: false })),
            show(() => m.styleText("none", s, { validateStream: false })),
            show(() => m.styleText("notacolour", s, { validateStream: false })),
            show(() => JSON.stringify(m.parseArgs({
              args: ["--flag", "--name", s, "positional"],
              options: { flag: { type: "boolean" }, name: { type: "string" } },
              allowPositionals: true,
            }))),
            show(() => JSON.stringify(m.parseArgs({ args: ["-x", s], options: {}, strict: false }))),
            show(() => m.diff === undefined ? "absent" : JSON.stringify(m.diff(s, `${s}x`))),
          ].join("|");
        },
      },
      {
        // **All 42 `util.types` predicates**, which the corpus never called once.
        // They are the purest thing in the module -- a value in, a boolean out,
        // no I/O and no state -- and they were the largest gap `corpus-reach.mjs`
        // found: 42 of `util`'s 72 published functions, not one exercised.
        //
        // Three values per input rather than the whole battery, chosen by the
        // input itself. Running 42 predicates over 35 values on every one of
        // 4,000 inputs is a million calls answering the same question repeatedly;
        // rotating through the battery covers it across the corpus and keeps each
        // input cheap.
        //
        // The battery holds the pairs these predicates exist to tell apart and
        // that a naive implementation merges: a boxed `String` against a
        // primitive, a `Map` against a `Set`, a `DataView` against a
        // `Uint8Array`, a generator function against an ordinary one, a
        // `TypeError` against an `Error`, and a boxed `BigInt` against a bare one.
        label: "types-predicates",
        call: (m, s) => {
          const battery = [
            s, new String(s), s.length, new Number(s.length),
            Boolean(s.length % 2), new Boolean(s.length % 2),
            new Date(s.length * 1000), new RegExp(s.length % 2 === 0 ? "a" : "b"),
            new Map([["k", s]]), new Set([s]), new WeakMap(), new WeakSet(),
            new Map().entries(), new Set().values(), Promise.resolve(s),
            new ArrayBuffer(4), new DataView(new ArrayBuffer(4)),
            new Uint8Array(4), new Uint8ClampedArray(4), new Int16Array(2),
            new Float64Array(1), new BigInt64Array(1),
            new Error(s), new TypeError(s),
            (function* named() {})(), function* named() {},
            async function named() {}, () => s,
            Object(Symbol("x")), BigInt(s.length), Object(BigInt(s.length)),
            null, undefined, { a: 1 }, [1, 2],
          ];
          // **Eight predicates excluded, by name and with the reason.** Each
          // answers `false` for every value in `util/src/types.ts`, deliberately
          // and with its rationale written at the function: recognising a
          // generator, an async function, a Map/Set iterator or a boxed Symbol or
          // BigInt needs a runtime kind tag, and the structural alternative --
          // "has `next` and `throw`" -- would accept ordinary user objects. Node
          // asks V8 for the brand and this profile has no brand to ask.
          //
          // They are a recorded refusal, so this spec names them rather than
          // reporting 2,203 divergences that all say the same known thing. That
          // number is what the first run produced, and it is the measurement of
          // the refusal's cost: on every real generator, iterator, async function
          // and boxed primitive, node answers `true` and this profile answers
          // `false`. Excluding them here does not make that untrue; it stops one
          // known decision from hiding the other 35 predicates behind noise.
          const REFUSED = new Set([
            "isMapIterator", "isSetIterator", "isGeneratorObject",
            "isGeneratorFunction", "isAsyncFunction", "isBoxedPrimitive",
            "isSymbolObject", "isBigIntObject",
          ]);
          const names = Object.keys(m.types).sort().filter((k) => !REFUSED.has(k));
          const pick = (n) => battery[(s.length * 7 + n * 13) % battery.length];
          const out = [];
          for (let n = 0; n < 3; n++) {
            const value = pick(n);
            for (const name of names) {
              let answer;
              try {
                answer = m.types[name](value);
              } catch (error) {
                answer = `threw:${(error && error.code) || (error && error.name) || "?"}`;
              }
              out.push(answer === true ? "1" : answer === false ? "0" : String(answer));
            }
          }
          return `${names.length}:${out.join("")}`;
        },
      },
      // Error paths. See `REJECTED` above: the generated inputs are ones these
      // functions accept, so nothing here reached a validation branch until
      // these were added, and the `code` node's own suite asserts on was never
      // compared. `throws: true` tells the harness node is expected to reject,
      // and it holds those specs to the mirror of its typo guard -- node must
      // throw a *coded* error, which an undefined-property typo does not.
      { label: "promisify!", throws: true, call: (m, s) => m.promisify(rejected(s)) },
      { label: "format(t)", call: (m, t) => m.format(t) },
      { label: "format(t,'x')", call: (m, t) => m.format(t, "x") },
      { label: "format(t,42)", call: (m, t) => m.format(t, 42) },
      { label: "format(t,obj)", call: (m, t) => m.format(t, { a: 1, b: [2, 3] }) },
      {
        label: "format(t,many)",
        call: (m, t) => m.format(t, "x", 42, { a: 1 }, [1, 2], null, undefined, true),
      },
      {
        label: "formatWithOptions(t,many)",
        call: (m, t) =>
          m.formatWithOptions({ colors: false, depth: 2 }, t, "x", 42, { a: 1 }, [1, 2]),
      },
      { label: "inspect(t)", call: (m, t) => m.inspect(t) },
      { label: "stripVTControlCharacters(t)", call: (m, t) => m.stripVTControlCharacters(t) },
      { label: "toUSVString(t)", call: (m, t) => m.toUSVString(t) },

      // **The rest of `util`**, which was 48 of 86. The 38 uncalled names were the
      // error constructors, the callback/promise adapters, the deprecation
      // helpers, the whole of `MIMEType`/`MIMEParams`, the encoders, and the
      // abort-signal helpers.
      //
      // Eight of the 38 stay uncalled on purpose and are not here: the
      // brand-checking `types` predicates excluded at `types-predicates` above,
      // where the refusal and its 2,203-divergence cost are already written down.
      //
      // Every argument is derived from the input, because a spec that hands a
      // fixed value to a pure function compares a constant. `seed` is the input
      // read as a number and `pick` indexes a list with it, so which branch a
      // call takes is a function of the input rather than of the spec.
      {
        label: "util-errors",
        call: (m, t) => {
          const seed = t.length + (t.charCodeAt(0) || 0);
          const pick = (list) => list[seed % list.length];
          const out = [];
          // `_errnoException` and `_exceptionWithHostPort` are what the net and
          // dgram stand-ins build their errors with, so their shape is what a
          // caller catches. Compared through `code`, `errno`, `syscall`, the
          // message and the own property names -- the last because node attaches
          // `address` and `port` as own properties and a merged implementation
          // that only formats the message would pass on the text alone.
          const ERRNO = [-2, -13, -98, -4094, 0, 1];
          const SYSCALL = ["open", "connect", "bind", pick(["listen", "read"])];
          for (const errno of [pick(ERRNO), ERRNO[(seed * 3) % ERRNO.length]]) {
            for (const syscall of [pick(SYSCALL)]) {
              try {
                const e = m._errnoException(errno, syscall, pick([undefined, t]));
                out.push(`E|${e.code}|${e.errno}|${e.syscall}|${e.message}`);
              } catch (error) {
                out.push(`E|threw:${error.code || error.name}`);
              }
              try {
                const e = m._exceptionWithHostPort(errno, syscall, pick(["1.2.3.4", "::1", t]),
                  seed % 65536, pick([undefined, "extra"]));
                out.push(`H|${e.code}|${e.syscall}|${e.address}|${e.port}|${e.message}` +
                  `|${Object.keys(e).sort().join(",")}`);
              } catch (error) {
                out.push(`H|threw:${error.code || error.name}`);
              }
            }
          }
          // A signal name in, an exit code out. Node's answer is 128 + the
          // signal's number, and an unknown name is rejected rather than
          // guessed, so the list mixes real names with near-misses.
          for (const sig of [pick(["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP", "SIGUSR2",
            "sigint", "SIGNOPE", "", t, "9"])]) {
            try {
              out.push(`S|${sig}|${m.convertProcessSignalToExitCode(sig)}`);
            } catch (error) {
              out.push(`S|${sig}|threw:${error.code || error.name}`);
            }
          }
          return out.join("\n");
        },
      },
      {
        // The deprecation helpers, `inherits` and `_extend`.
        //
        // `deprecate` is compared through the *wrapper* rather than the warning:
        // the returned function must keep the original's arity and answer, must
        // carry the code, and must be marked deprecated. Node's wrapper is named
        // `deprecated`, which is the one observable that a pass-through
        // implementation returning the original function would fail -- and that
        // exact substitution is how `process._extend`'s `name` was found wrong.
        //
        // The warning itself is deliberately not compared: it is emitted once per
        // wrapper per process and `--no-deprecation` suppresses it, so its
        // presence is a fact about the process rather than about the input.
        label: "util-deprecate",
        call: (m, t) => {
          const seed = t.length + (t.charCodeAt(0) || 0);
          const out = [];
          const original = (a, b) => `${a}/${b}/${t}`;
          try {
            const wrapped = m.deprecate(original, `${t} is deprecated`, `DEP${seed % 10000}`);
            out.push(`D|${wrapped.length}|${wrapped.name}|${wrapped("x", "y")}`);
            out.push(`D|calledTwiceSame:${wrapped("x", "y") === wrapped("x", "y")}`);
          } catch (error) {
            out.push(`D|threw:${error.code || error.name}`);
          }
          // A wrapper over a constructor must still construct, which a naive
          // `(...args) => fn(...args)` forwarder does not.
          try {
            function Ctor(v) { this.v = v; }
            const Wrapped = m.deprecate(Ctor, "ctor", "DEP0001");
            out.push(`C|${new Wrapped(t).v === t}`);
          } catch (error) {
            out.push(`C|threw:${error.code || error.name}`);
          }
          // `inherits`, through the chain it builds and `super_`, plus its
          // validation: node rejects a missing prototype with a coded error.
          const BAD = [undefined, null, {}, function noProto() {}];
          try {
            function Base() {}
            Base.prototype.tag = () => t;
            function Derived() {}
            m.inherits(Derived, Base);
            const d = new Derived();
            out.push(`I|${d instanceof Base}|${d.tag()}|${Derived.super_ === Base}` +
              `|${Object.getPrototypeOf(Derived.prototype) === Base.prototype}` +
              `|${d.constructor === Derived}`);
          } catch (error) {
            out.push(`I|threw:${error.code || error.name}`);
          }
          try {
            const bad = BAD[seed % BAD.length];
            if (typeof bad === "function") delete bad.prototype;
            m.inherits(function Sub() {}, bad);
            out.push("I|badAccepted");
          } catch (error) {
            out.push(`I|bad:${error.code || error.name}`);
          }
          // `_extend` copies own enumerable string keys from the source and
          // answers the target, and a non-object source is returned unchanged
          // rather than rejected. Its own `name` is `deprecated`, which is the
          // check that it is wrapped at all.
          try {
            const target = { a: 1, keep: t };
            const source = { a: 2, b: t, [Symbol("s")]: 1 };
            Object.defineProperty(source, "hidden", { value: 9, enumerable: false });
            const got = m._extend(target, source);
            out.push(`X|${got === target}|${JSON.stringify(got)}|${"hidden" in got}` +
              `|${m._extend.name}`);
            out.push(`X|${JSON.stringify(m._extend({ z: 1 }, [seed]))}`);
            out.push(`X|primitive:${JSON.stringify(m._extend({ z: 1 }, seed))}`);
          } catch (error) {
            out.push(`X|threw:${error.code || error.name}`);
          }
          return out.join("\n");
        },
      },
      {
        // `debuglog`/`debug` through their **validation and their disabled
        // shape**, not through what they print.
        //
        // Whether a section is enabled is a fact about `NODE_DEBUG` in the
        // environment, and both lanes run without it, so comparing `enabled`
        // alone would be a check whose answer never depends on its input. What
        // does depend on the input is the argument: a non-string section is
        // rejected with a coded error, and a non-function callback likewise, so
        // the list mixes accepted and rejected values chosen by the input.
        label: "util-debuglog",
        call: (m, t) => {
          const seed = t.length + (t.charCodeAt(0) || 0);
          const SECTIONS = [t, "", "nts", 1, null, undefined, {}, Symbol.iterator];
          const CALLBACKS = [undefined, () => {}, "not a function", 1, null];
          const out = [];
          for (const fn of ["debuglog", "debug"]) {
            const section = SECTIONS[seed % SECTIONS.length];
            const cb = CALLBACKS[(seed * 3) % CALLBACKS.length];
            try {
              const log = m[fn](section, cb);
              // A disabled logger must still be callable and answer undefined,
              // which is the whole of its contract when off.
              out.push(`${fn}|${typeof log}|${log.enabled}|${log(t, 1, {}) === undefined}`);
            } catch (error) {
              out.push(`${fn}|threw:${error.code || error.name}`);
            }
          }
          return out.join("\n");
        },
      },
      {
        // `callbackify` and `promisify`'s other direction, both awaited.
        //
        // The two halves that matter: a rejection must reach the callback as its
        // first argument, and a function that rejects with a *falsy* reason must
        // still arrive as an error -- node wraps it, because a falsy first
        // argument would read as success. That wrapping is the observable a
        // straightforward implementation misses, so the input chooses the
        // rejection reason from a list whose entries are mostly falsy.
        label: "util-callbackify",
        call: async (m, t) => {
          const seed = t.length + (t.charCodeAt(0) || 0);
          const REASONS = [null, undefined, 0, "", false, NaN, new Error(t), t];
          const reason = REASONS[seed % REASONS.length];
          const out = [];
          const settle = (fn) => new Promise((resolve) => {
            try {
              fn((...args) => resolve(args));
            } catch (error) {
              resolve([`threw:${error.code || error.name}`]);
            }
          });
          try {
            const ok = m.callbackify(async (v) => `${v}!`);
            const got = await settle((cb) => ok(t, cb));
            out.push(`ok|${got.length}|${got[0]}|${got[1]}`);
          } catch (error) {
            out.push(`ok|threw:${error.code || error.name}`);
          }
          try {
            const bad = m.callbackify(async () => { throw reason; });
            const got = await settle((cb) => bad(cb));
            const err = got[0];
            out.push(`bad|${got.length}|${typeof err}|${err instanceof Error}` +
              `|${err && err.reason === reason}|${String(err && err.message).slice(0, 40)}`);
          } catch (error) {
            out.push(`bad|threw:${error.code || error.name}`);
          }
          // Its validation, and that the callback is required at the call.
          for (const arg of [undefined, null, 1, "x", {}]) {
            try {
              m.callbackify(arg);
              out.push(`v|${typeof arg}|accepted`);
            } catch (error) {
              out.push(`v|${typeof arg}|${error.code || error.name}`);
            }
          }
          try {
            m.callbackify(async () => 1)();
            out.push("missing|accepted");
          } catch (error) {
            out.push(`missing|${error.code || error.name}`);
          }
          return out.join("\n");
        },
      },
      {
        // The abort-signal helpers. `aborted` resolves when a signal fires, so
        // **every arm here aborts** -- a signal that never fires leaves the
        // promise pending, the loop drains with it unsettled, and the probe's
        // child exits with node's unsettled-await status rather than an answer.
        // One arm is already aborted before `aborted` is called, which is the
        // case a naive implementation that only subscribes to the event misses.
        label: "util-abort",
        call: async (m, t) => {
          const seed = t.length + (t.charCodeAt(0) || 0);
          const out = [];
          try {
            const already = AbortSignal.abort(t);
            let resolved = false;
            await m.aborted(already, {}).then(() => { resolved = true; });
            out.push(`already|${resolved}|${already.aborted}|${already.reason}`);
          } catch (error) {
            out.push(`already|threw:${error.code || error.name}`);
          }
          try {
            const ac = new AbortController();
            const seen = m.aborted(ac.signal, {}).then(() => "settled");
            ac.abort(seed % 2 === 0 ? new Error(t) : t);
            out.push(`later|${await seen}|${ac.signal.aborted}` +
              `|${ac.signal.reason instanceof Error ? "Error" : ac.signal.reason}`);
          } catch (error) {
            out.push(`later|threw:${error.code || error.name}`);
          }
          // Its validation: a non-signal and a non-object resource are both
          // rejected, and which one this input tries is chosen by the input.
          const BAD = [[undefined, {}], [null, {}], [{}, {}], [AbortSignal.abort(), null],
            [AbortSignal.abort(), 1], [AbortSignal.abort(), undefined]];
          const [sig, res] = BAD[seed % BAD.length];
          try {
            await m.aborted(sig, res);
            out.push("bad|accepted");
          } catch (error) {
            out.push(`bad|${error.code || error.name}`);
          }
          // `transferableAbortSignal` marks a signal transferable and answers the
          // same signal; `transferableAbortController` builds a controller whose
          // signal is already marked. Compared through identity and through the
          // signal still working, because a helper that returned a fresh
          // unlinked signal would look right and abort nothing.
          try {
            const ac = m.transferableAbortController();
            const marked = ac.signal;
            const fired = m.aborted(marked, {}).then(() => "fired");
            ac.abort(t);
            out.push(`tac|${marked instanceof AbortSignal}|${await fired}|${marked.reason}`);
          } catch (error) {
            out.push(`tac|threw:${error.code || error.name}`);
          }
          try {
            const plain = new AbortController();
            const same = m.transferableAbortSignal(plain.signal);
            out.push(`tas|${same === plain.signal}|${same instanceof AbortSignal}`);
            plain.abort(t);
            out.push(`tas|${same.aborted}|${same.reason}`);
          } catch (error) {
            out.push(`tas|threw:${error.code || error.name}`);
          }
          for (const bad of [undefined, null, {}, new AbortController()]) {
            try {
              m.transferableAbortSignal(bad);
              out.push(`tas|bad:accepted:${typeof bad}`);
            } catch (error) {
              out.push(`tas|bad:${error.code || error.name}`);
            }
          }
          return out.join("\n");
        },
      },
      {
        // `TextEncoder`/`TextDecoder`, over the input's own bytes.
        //
        // `encodeInto` is the interesting one: it writes into a caller's buffer
        // and answers how far it got, so the destination is deliberately *too
        // small* on one arm. Node stops on a character boundary rather than
        // splitting a surrogate pair, so a short buffer is where an
        // implementation that counts bytes instead of code points diverges.
        label: "util-text-codec",
        call: (m, t) => {
          const seed = t.length + (t.charCodeAt(0) || 0);
          const out = [];
          const encoder = new m.TextEncoder();
          const bytes = encoder.encode(t);
          out.push(`enc|${encoder.encoding}|${bytes.length}|${Array.from(bytes).join(",")}`);
          out.push(`enc|empty:${encoder.encode().length}|undef:${encoder.encode(undefined).length}`);
          for (const size of [0, 1, 2, Math.max(0, bytes.length - 1), bytes.length,
            bytes.length + 4]) {
            const dest = new Uint8Array(size);
            const got = encoder.encodeInto(t, dest);
            out.push(`into|${size}|${got.read}|${got.written}|${Array.from(dest).join(",")}`);
          }
          const DECODERS = ["utf-8", "utf8", "latin1", "utf-16le", "ascii"];
          for (const label of [DECODERS[seed % DECODERS.length], "utf-8"]) {
            try {
              const decoder = new m.TextDecoder(label, { fatal: seed % 2 === 0 });
              out.push(`dec|${label}|${decoder.encoding}|${decoder.fatal}` +
                `|${decoder.ignoreBOM}|${decoder.decode(bytes)}`);
              out.push(`dec|${label}|empty:${decoder.decode()}` +
                `|part:${decoder.decode(bytes.subarray(0, Math.max(0, bytes.length - 1)))}`);
            } catch (error) {
              out.push(`dec|${label}|threw:${error.code || error.name}`);
            }
          }
          // Lone continuation and truncated sequences, which is where a decoder
          // either substitutes U+FFFD or throws depending on `fatal`.
          for (const fatal of [false, true]) {
            try {
              const decoder = new m.TextDecoder("utf-8", { fatal });
              const broken = new Uint8Array([0x80, 0xc3, 0xe2, 0x82, bytes[0] ?? 0x41]);
              out.push(`broken|${fatal}|${JSON.stringify(decoder.decode(broken))}`);
            } catch (error) {
              out.push(`broken|${fatal}|threw:${error.code || error.name}`);
            }
          }
          return out.join("\n");
        },
      },
      {
        // `MIMEType` and every `MIMEParams` method, over a type built from the
        // input. The type string is assembled rather than taken raw so that most
        // inputs reach the parameter machinery instead of being rejected at the
        // first slash, and the raw input is tried as well for the rejections.
        label: "util-mime",
        call: (m, t) => {
          const seed = t.length + (t.charCodeAt(0) || 0);
          const word = (t.replace(/[^a-zA-Z0-9]/g, "") || "plain").slice(0, 8);
          const built = `text/${word};charset=utf-8;q=0.${seed % 10}`;
          const out = [];
          for (const spelling of [built, t, `${word}/${word}`, "text/plain;a=1;a=2"]) {
            try {
              const mime = new m.MIMEType(spelling);
              const params = mime.params;
              out.push(`M|${mime.type}|${mime.subtype}|${mime.essence}|${mime.toString()}` +
                `|${JSON.stringify(mime.toJSON())}`);
              out.push(`P|has:${params.has("charset")}|get:${params.get("charset")}` +
                `|missing:${params.get("nope")}|hasMissing:${params.has("nope")}`);
              params.set("added", word);
              out.push(`P|afterSet:${params.toString()}|${mime.toString()}`);
              out.push(`P|keys:${[...params.keys()].join(",")}` +
                `|values:${[...params.values()].join(",")}` +
                `|entries:${[...params.entries()].map((e) => e.join("=")).join(";")}`);
              out.push(`P|json:${JSON.stringify(params.toJSON())}`);
              params.delete("charset");
              out.push(`P|afterDelete:${params.toString()}|${params.has("charset")}` +
                `|${mime.toString()}`);
              // Mutating `type`/`subtype` must re-render, and an invalid one must
              // be rejected rather than stored.
              try {
                mime.subtype = word || "x";
                out.push(`M|subtypeSet:${mime.toString()}`);
              } catch (error) {
                out.push(`M|subtypeSet:${error.code || error.name}`);
              }
              for (const bad of ["", "no slash", t]) {
                try {
                  params.set(bad, "v");
                  out.push(`P|setBad:${JSON.stringify(bad)}:accepted:${params.toString()}`);
                } catch (error) {
                  out.push(`P|setBad:${JSON.stringify(bad)}:${error.code || error.name}`);
                }
              }
            } catch (error) {
              out.push(`M|${JSON.stringify(spelling)}|threw:${error.code || error.name}`);
            }
          }
          return out.join("\n");
        },
      },
      {
        // `parseEnv`, over a `.env` document assembled from the input.
        //
        // Its rules are the reason this is worth comparing: `export` prefixes are
        // stripped, quotes come off, a double-quoted value expands `\n`, a
        // single-quoted one does not, `#` starts a comment except inside quotes,
        // and a later assignment wins. Each of those is a line here, and the
        // input picks the separator and slips into the values.
        label: "util-parse-env",
        call: (m, t) => {
          const seed = t.length + (t.charCodeAt(0) || 0);
          const word = (t.replace(/[^a-zA-Z0-9]/g, "") || "V").slice(0, 6);
          const NL = ["\n", "\r\n", "\n\n"][seed % 3];
          const doc = [
            `A=${word}`,
            `export B=${word}`,
            `C="${word}\\nline"`,
            `C2='${word}\\nline'`,
            `D=${word} # trailing`,
            `E="${word} # inside"`,
            `# whole line ${word}`,
            `F=`,
            `G`,
            `  H  =  ${word}  `,
            `A=${word}again`,
            `I=${JSON.stringify(t)}`,
            `J=\`${word}\``,
            `=${word}`,
            `K=multi`,
          ].join(NL);
          const out = [];
          for (const text of [doc, t, "", `${word}=${word}`]) {
            try {
              const got = m.parseEnv(text);
              out.push(`P|${Object.keys(got).sort().join(",")}|${JSON.stringify(got)}`);
            } catch (error) {
              out.push(`P|threw:${error.code || error.name}`);
            }
          }
          for (const bad of [undefined, null, 1, {}, []]) {
            try {
              out.push(`bad|${typeof bad}|${JSON.stringify(m.parseEnv(bad))}`);
            } catch (error) {
              out.push(`bad|${typeof bad}|${error.code || error.name}`);
            }
          }
          return out.join("\n");
        },
      },
      {
        // `isDeepStrictEqual` and `getCallSites`.
        //
        // `isDeepStrictEqual` is `assert.deepStrictEqual`'s predicate half and is
        // published separately, so it is called here over the pairs that
        // separate deep-strict from deep-loose: a boxed primitive against its
        // primitive, `-0` against `0`, `NaN` against itself, a symbol key on one
        // side only -- the last being the arm that found this profile ignoring
        // symbol keys altogether.
        //
        // `getCallSites` is compared through **the frame count it honours and
        // the keys of a frame**, never through file names or line numbers: the
        // host evaluates specs inside the harness and the probe evaluates them
        // inside a child, so the locations differ by construction and are not a
        // function of the input. The requested count is.
        label: "util-deep-and-callsites",
        call: (m, t) => {
          const seed = t.length + (t.charCodeAt(0) || 0);
          const sym = Symbol.for(`nts.${t.length % 4}`);
          const PAIRS = [
            [{ a: 1 }, { a: 1 }],
            [{ a: 1, [sym]: t }, { a: 1 }],
            [{ a: 1, [sym]: t }, { a: 1, [sym]: t }],
            [new String(t), t],
            [-0, 0],
            [NaN, NaN],
            [[1, 2], [1, 2]],
            [new Map([["k", t]]), new Map([["k", t]])],
            [new Set([t]), new Set([t])],
            [new Date(seed * 1000), new Date(seed * 1000)],
            [/a/g, /a/g],
            [Object.create(null), {}],
            [new Error(t), new Error(t)],
            [Buffer.from(t), Buffer.from(t)],
          ];
          const out = [];
          for (const [left, right] of PAIRS) {
            try {
              out.push(m.isDeepStrictEqual(left, right) ? "1" : "0");
            } catch (error) {
              out.push(`t:${error.code || error.name}`);
            }
          }
          const answers = out.join("");
          const frames = [];
          for (const n of [1, 1 + (seed % 4), 0, 20]) {
            try {
              const got = m.getCallSites(n);
              frames.push(`${n}|${Array.isArray(got)}|${got.length <= Math.max(n, 0)}` +
                `|${got.length > 0 ? Object.keys(got[0]).sort().join(",") : "none"}`);
            } catch (error) {
              frames.push(`${n}|threw:${error.code || error.name}`);
            }
          }
          for (const bad of [-1, "x", {}, 1.5]) {
            try {
              const got = m.getCallSites(bad);
              frames.push(`bad:${JSON.stringify(bad)}|accepted:${Array.isArray(got)}`);
            } catch (error) {
              frames.push(`bad:${JSON.stringify(bad)}|${error.code || error.name}`);
            }
          }
          // `setTraceSigInt` toggles a flag with no readable answer, so what is
          // compared is that it accepts a boolean and rejects a non-boolean --
          // the only part of it that is observable from outside.
          const trace = [];
          for (const arg of [seed % 2 === 0, !(seed % 2), undefined, 1, "x", null]) {
            try {
              trace.push(`${typeof arg}:${m.setTraceSigInt(arg) === undefined}`);
            } catch (error) {
              trace.push(`${typeof arg}:${error.code || error.name}`);
            }
          }
          // Leave it off regardless of which arm ran last, so this spec does not
          // change how the process answers a later signal.
          try { m.setTraceSigInt(false); } catch { /* recorded above */ }
          return `${answers}\n${frames.join("\n")}\n${trace.join("|")}`;
        },
      },
    ],
  },

  zlib: {
    // Byte-for-byte against node's output, not merely a round trip. Two
    // implementations of the same format can both be correct and disagree on
    // the bytes, so if these diverge the right question is which knob differs
    // -- level, strategy, window bits, memLevel -- and that is worth knowing.
    fixed: [
      "", "a", "aa", "a".repeat(1000), "ab".repeat(500), "\u0000".repeat(64),
      "ü", "日本語", "😀", "The quick brown fox jumps over the lazy dog",
      "0123456789".repeat(100), "\uD800", "\uFFFD",
    ],
    input: (rnd) => unicodeWord(rnd, 40),
    calls: [
      {
        // **`unzipSync`, the `zstd` pair and `crc32`**, which the round-trip specs
        // above never reach. `unzipSync` is not another decompressor: it *sniffs*
        // the header and dispatches, so it is the only one that can be wrong about
        // which format it was given, and it is fed both gzip and deflate output
        // here for that reason.
        //
        // `crc32` is pure arithmetic over bytes and the cheapest thing in the module
        // to get subtly wrong -- a wrong polynomial or a missing final xor agrees
        // with itself on every round trip and with node on nothing.
        // **The asynchronous half of this module, which nothing compared until now.**
        //
        // `corpus-reach.mjs` put zlib at 12 of 45 published functions called. The 33 it never
        // reached were not an oversight in the specs: `differential-ts.mjs` and its probe were
        // synchronous, so a spec could not await anything, and every callback-taking function in
        // every module was structurally out of reach. Both halves now await, so these are
        // reachable for the first time.
        //
        // Byte-for-byte against node's output, which is this corpus's standing rule for zlib --
        // two correct implementations of one format may still disagree on the bytes, and which
        // knob differs is worth knowing. The round trips are here as well because a compressor
        // and a decompressor can be wrong together and agree with themselves.
        // **The stream constructors, which are the last 22 of this module's 45.** `create*`
        // and the classes they wrap are the same codecs reached a third way, and the corpus had
        // neither: they are transforms, so they answer over several events, and nothing could
        // await one until the harness learned to.
        //
        // Byte-for-byte against node's output, as everything else in this corpus is. A transform
        // is written to and drained here rather than piped, which needs no `Readable` and so
        // keeps this a comparison of `zlib` and not of whatever `stream` either side is using.
        label: "stream-codecs",
        call: async (m, s) => {
          const bytes = Buffer.from(s, "utf8");
          const through = (make, input) =>
            new Promise((resolve) => {
              let z;
              try {
                z = make();
              } catch (error) {
                resolve(`threw:${error?.code ?? error?.name ?? "?"}`);
                return;
              }
              if (z === undefined || z === null) { resolve("absent"); return; }
              const chunks = [];
              z.on("data", (chunk) => chunks.push(chunk));
              z.on("end", () => resolve(Buffer.concat(chunks)));
              z.on("error", (error) => resolve(`threw:${error?.code ?? error?.name ?? "?"}`));
              z.end(input);
            });
          const render = (v) => (Buffer.isBuffer(v) ? v.toString("base64") : String(v));
          const has = (name) => typeof m[name] === "function";
          const packed = async (name) => (has(name) ? render(await through(() => m[name](), bytes)) : "absent");
          // A round trip through two transforms, which is the arm that catches a compressor and
          // a decompressor that are wrong together and agree with each other.
          const trip = async (out, back) => {
            if (!has(out) || !has(back)) return "absent";
            const compressed = await through(() => m[out](), bytes);
            if (!Buffer.isBuffer(compressed)) return compressed;
            const restored = await through(() => m[back](), compressed);
            return Buffer.isBuffer(restored)
              ? (restored.equals(bytes) ? "round-trip" : `differs:${restored.length}/${bytes.length}`)
              : restored;
          };
          return [
            await packed("createDeflate"),
            await packed("createGzip"),
            await packed("createDeflateRaw"),
            await packed("createBrotliCompress"),
            await packed("createZstdCompress"),
            await trip("createDeflate", "createInflate"),
            await trip("createGzip", "createGunzip"),
            await trip("createDeflateRaw", "createInflateRaw"),
            await trip("createGzip", "createUnzip"),
            await trip("createBrotliCompress", "createBrotliDecompress"),
            await trip("createZstdCompress", "createZstdDecompress"),
            // **Every class behind them, constructed directly.** node publishes both spellings
            // and a reimplementation can wire `createGzip` to something the class is not. The
            // decompressors are fed the same plain bytes as the compressors: they fail, and
            // *how* they fail is the comparison -- an unrecognised header has a specific code
            // and a reimplementation that answers a generic error looks fine until someone
            // catches on it.
            (await Promise.all(
              ["Deflate", "Inflate", "Gzip", "Gunzip", "DeflateRaw", "InflateRaw", "Unzip",
                "BrotliCompress", "BrotliDecompress", "ZstdCompress", "ZstdDecompress"]
                .map(async (name) => (typeof m[name] === "function"
                  ? `${name}=${render(await through(() => new m[name](), bytes))}`
                  : `${name}=absent`)),
            )).join(";"),
          ].join("|");
        },
      },
      {
        label: "async-codecs",
        call: async (m, s) => {
          const bytes = Buffer.from(s, "utf8");
          // A callback API turned into one promise, resolving to a comparable string either way.
          // A synchronous throw and an error argument both become `threw:CODE`, because node
          // reports validation one way and codec failure the other and this spec cares about
          // neither distinction -- only about the two implementations agreeing.
          const run = (fn, ...args) =>
            new Promise((resolve) => {
              if (typeof fn !== "function") { resolve("absent"); return; }
              try {
                fn(...args, (error, out) => {
                  if (error) { resolve(`threw:${error.code ?? error.name ?? "?"}`); return; }
                  resolve(out instanceof Uint8Array ? Buffer.from(out).toString("base64") : String(out));
                });
              } catch (error) {
                resolve(`threw:${error.code ?? error.name ?? "?"}`);
              }
            });
          const trip = async (compress, decompress) => {
            const packed = await run(compress, bytes);
            if (packed === "absent" || packed.startsWith("threw:")) return packed;
            return run(decompress, Buffer.from(packed, "base64"));
          };
          return [
            await run(m.deflate, bytes),
            await run(m.gzip, bytes),
            await run(m.deflateRaw, bytes),
            await run(m.brotliCompress, bytes),
            await run(m.zstdCompress, bytes),
            await trip(m.deflate, m.inflate),
            await trip(m.gzip, m.gunzip),
            await trip(m.deflateRaw, m.inflateRaw),
            await trip(m.gzip, m.unzip),
            await trip(m.brotliCompress, m.brotliDecompress),
            await trip(m.zstdCompress, m.zstdDecompress),
          ].join("|");
        },
      },
      {
        label: "unzip-zstd-crc32",
        call: (m, s) => {
          const bytes = Buffer.from(s, "utf8");
          const show = (f) => {
            try {
              const v = f();
              if (v instanceof Uint8Array) return v.toString("base64");
              return String(v);
            } catch (error) {
              return `threw:${(error && error.code) || (error && error.name) || "?"}`;
            }
          };
          return [
            show(() => m.unzipSync(m.gzipSync(bytes)).toString("utf8")),
            show(() => m.unzipSync(m.deflateSync(bytes)).toString("utf8")),
            show(() => m.unzipSync(bytes)),
            show(() => m.zstdCompressSync === undefined ? "absent" : m.zstdDecompressSync(m.zstdCompressSync(bytes)).toString("utf8")),
            show(() => m.crc32 === undefined ? "absent" : m.crc32(s)),
            show(() => m.crc32 === undefined ? "absent" : m.crc32(bytes)),
            show(() => m.crc32 === undefined ? "absent" : m.crc32(s, 1)),
          ].join("|");
        },
      },
      // Error paths. See `REJECTED` above: the generated inputs are ones these
      // functions accept, so nothing here reached a validation branch until
      // these were added, and the `code` node's own suite asserts on was never
      // compared. `throws: true` tells the harness node is expected to reject,
      // and it holds those specs to the mirror of its typo guard -- node must
      // throw a *coded* error, which an undefined-property typo does not.
      { label: "gzipSync!", throws: true, call: (m, s) => m.gzipSync(rejected(s)) },
      { label: "deflateSync!", throws: true, call: (m, s) => m.deflateSync(rejected(s)) },
      { label: "brotliCompressSync!", throws: true, call: (m, s) => m.brotliCompressSync(rejected(s)) },
      ...["gzip", "deflate", "deflateRaw", "brotliCompress"].map((kind) => ({
        label: `${kind}Sync`,
        call: (m, s) => m[`${kind}Sync`](Buffer.from(s, "utf8")).toString("base64"),
      })),
      // The round trips, which are the property that has to hold whatever the
      // bytes are.
      ...[["gzip", "gunzip"], ["deflate", "inflate"], ["deflateRaw", "inflateRaw"],
        ["brotliCompress", "brotliDecompress"]].map(([out, back]) => ({
        label: `${out}/${back}`,
        call: (m, s) => m[`${back}Sync`](m[`${out}Sync`](Buffer.from(s, "utf8"))).toString("utf8"),
      })),
      // A level that is not the default, since the default is the only one a
      // round trip exercises.
      {
        label: "gzipSync(level 1)",
        call: (m, s) => m.gzipSync(Buffer.from(s, "utf8"), { level: 1 }).toString("base64"),
      },
      {
        label: "gzipSync(level 9)",
        call: (m, s) => m.gzipSync(Buffer.from(s, "utf8"), { level: 9 }).toString("base64"),
      },
    ],
  },

  string_decoder: {
    // A StringDecoder exists to carry a partial character across a chunk
    // boundary, so the boundary is the whole test. Each input is encoded and
    // then split at every position in turn, which puts a split inside a
    // two-, three- and four-byte sequence and inside a surrogate pair.
    //
    // Three pinned test files cover this module. Chunked decoding of astral
    // text is not among them.
    fixed: [
      "", "a", "ü", "€", "😀", "aü", "ü😀", "😀😀", "日本語", "a😀b",
      "\uD800", "\uDC00", "a\uD800", "\uD83D\uDE00", "ÿÿÿÿ", "€€€€",
    ],
    input: (rnd) => unicodeWord(rnd, 6),
    calls: ["utf8", "utf16le", "latin1", "base64", "hex", "ascii"].flatMap((enc) => [
      {
        label: `whole(${enc})`,
        call: (m, s) => {
          const d = new m.StringDecoder(enc);
          return d.write(Buffer.from(s, "utf8")) + d.end();
        },
      },
      {
        label: `split-every-byte(${enc})`,
        call: (m, s) => {
          const bytes = Buffer.from(s, "utf8");
          const out = [];
          for (let cut = 0; cut <= bytes.length; cut++) {
            const d = new m.StringDecoder(enc);
            out.push(d.write(bytes.subarray(0, cut)) + d.write(bytes.subarray(cut)) + d.end());
          }
          return out.join("|");
        },
      },
      {
        label: `byte-at-a-time(${enc})`,
        call: (m, s) => {
          const bytes = Buffer.from(s, "utf8");
          const d = new m.StringDecoder(enc);
          let out = "";
          for (let i = 0; i < bytes.length; i++) out += d.write(bytes.subarray(i, i + 1));
          return out + d.end();
        },
      },
    ]).concat([
      // Error path. An unknown encoding is the one thing
      // `StringDecoder`'s constructor rejects, and `throws: true` holds this
      // spec to the mirror of the harness's typo guard: node must throw a
      // *coded* error, which an undefined-property typo does not.
      {
        label: "StringDecoder!",
        throws: true,
        call: (m, s) => new m.StringDecoder(`no-such-encoding-${String(s).length}`),
      },
    ]),
  },

  url: {
    // The legacy parser is the interesting half: `url.parse` predates WHATWG,
    // has its own rules for slashes, auth and hosts, and 45 pinned files is
    // thin for a surface that large.
    fixed: [
      "", "/", "//", "///", "http://a", "http://a/", "http://a:1/b?c#d",
      "//a/b", "a:b", "a://b", "http://user:pass@host:8080/p?q=1#f",
      "HTTP://A.COM/B", "http://[::1]:8080/", "http://a..b/", "file:///a/b",
      "mailto:a@b.c", "javascript:alert(1)", "http://ü.com/日", "?q", "#f",
      "http://a/%2e%2e/b", "http://a/../b", "http://a\\b", "  http://a  ",
    ],
    input: (rnd) => {
      const SCHEME = ["http:", "https:", "file:", "ftp:", "a+b:", "", "mailto:"];
      const SLASH = ["//", "/", "", "///"];
      const HOST = ["a.com", "ü.com", "[::1]", "1.2.3.4", "a..b", "", "A.COM", "a:1", "u:p@h"];
      const PATH = ["", "/", "/a", "/a/b", "/a%2Fb", "/..", "/./", "/日", "//x"];
      const TAIL = ["", "?q=1", "?", "#f", "#", "?q=1#f", "?a=%zz"];
      return choose(rnd, SCHEME) + choose(rnd, SLASH) + choose(rnd, HOST) +
        choose(rnd, PATH) + choose(rnd, TAIL);
    },
    calls: [
      {
        // **`URLSearchParams.delete` and `has` with a second argument**, which
        // node added and which has one case nothing here covered: an explicit
        // `undefined` is treated as *no value given*, so `delete(name, undefined)`
        // behaves as the one-argument form and removes every entry for the name.
        // A reimplementation that coerces the second argument to the string
        // `"undefined"` removes nothing, and every other row in this corpus keeps
        // agreeing.
        //
        // It came out of a compiler-lane refusal: an explicit `undefined` in a
        // `string` position has no representation, and `delete(name, undefined)`
        // is the call that would hit it. No `runtime/node` caller passes it -- the
        // callers that would are JavaScript, arriving through the napi wrapper --
        // so the behaviour was never going to be exercised from inside this
        // profile, and a differential is the only thing that would notice it
        // changing.
        label: "searchparams-two-arg",
        call: (m, s) => {
          const show = (f) => {
            try {
              return String(f());
            } catch (error) {
              return `threw:${(error && error.code) || (error && error.name) || "?"}`;
            }
          };
          const build = () => new m.URLSearchParams(`a=1&a=${s}&b=${s}&a=undefined`);
          return [
            show(() => { const p = build(); p.delete("a"); return p.toString(); }),
            show(() => { const p = build(); p.delete("a", undefined); return p.toString(); }),
            show(() => { const p = build(); p.delete("a", s); return p.toString(); }),
            show(() => { const p = build(); p.delete("a", "undefined"); return p.toString(); }),
            show(() => { const p = build(); p.delete(s, s); return p.toString(); }),
            show(() => build().has("a")),
            show(() => build().has("a", undefined)),
            show(() => build().has("a", s)),
            show(() => build().has("a", "undefined")),
            // A value that is definitely not present, because the rows above are
            // weak on this argument: for most inputs `has("a", s)` and `has("a")`
            // agree, and a control that made `has` ignore its second argument was
            // noticed on **1 of 24** inputs. This one separates them on every
            // input, which is what the row was for.
            show(() => build().has("a", "\u0000absent")),
            show(() => build().has("b", "\u0000absent")),
            show(() => build().getAll("a").join(",")),
            show(() => { const p = build(); p.set("a", s); return p.toString(); }),
            show(() => { const p = build(); p.append("a", s); return p.toString(); }),
          ].join("|");
        },
      },
      {
        // **`URL`'s own methods and the newer statics**, which the corpus never
        // reached: `toString`, `toJSON`, `URL.parse`, `URL.canParse`,
        // `resolveObject`, and `URLSearchParams`' `forEach` and `values`.
        //
        // `URL.parse` and `URL.canParse` answer the same question by different
        // routes, one returning `null` and the other `false`. **Defining
        // `canParse` as a try/catch around the constructor is indistinguishable
        // here** -- a control that did exactly that was noticed on 0 of 24
        // inputs, so it is a legitimate implementation rather than a shortcut
        // this spec can catch. That is worth stating: the row is not weak
        // coverage, it is a distinction that does not exist. `parse` returning
        // `undefined` instead of `null` is caught on 24 of 24, which is the
        // distinction that does.
        //
        // `toJSON` and `toString` are compared against `href` as well as each
        // other, because node specifies all three to be the same string and a
        // reimplementation that builds one of them separately drifts only on the
        // inputs where serialisation is not the identity.
        label: "url-methods",
        call: (m, s) => {
          const show = (f) => {
            try {
              const v = f();
              return v === null ? "null" : v === undefined ? "undefined" : String(v);
            } catch (error) {
              return `threw:${(error && error.code) || (error && error.name) || "?"}`;
            }
          };
          const base = "http://base.example/dir/page";
          return [
            show(() => new m.URL(s, base).toString()),
            show(() => new m.URL(s, base).toJSON()),
            show(() => new m.URL(s, base).href),
            show(() => m.URL.canParse(s)),
            show(() => m.URL.canParse(s, base)),
            show(() => {
              const u = m.URL.parse(s);
              return u === null ? "null" : u.href;
            }),
            show(() => {
              const u = m.URL.parse(s, base);
              return u === null ? "null" : u.href;
            }),
            show(() => {
              const p = new m.URLSearchParams(s);
              const seen = [];
              p.forEach(function (value, key, parent) {
                seen.push(`${key}=${value}:${parent === p}`);
              });
              return seen.join(",");
            }),
            show(() => [...new m.URLSearchParams(s).values()].join(",")),
            show(() => [...new m.URLSearchParams(s).keys()].join(",")),
            show(() => {
              const r = m.resolveObject(base, s);
              return r === null || typeof r !== "object" ? String(r) : String(r.href);
            }),
          ].join("|");
        },
      },
      // Error paths. See `REJECTED` above: the generated inputs are ones these
      // functions accept, so nothing here reached a validation branch until
      // these were added, and the `code` node's own suite asserts on was never
      // compared. `throws: true` tells the harness node is expected to reject,
      // and it holds those specs to the mirror of its typo guard -- node must
      // throw a *coded* error, which an undefined-property typo does not.
      { label: "fileURLToPath!", throws: true, call: (m, s) => m.fileURLToPath(rejected(s)) },
      { label: "pathToFileURL!", throws: true, call: (m, s) => m.pathToFileURL(rejected(s)) },
      {
        // `URLSearchParams` as a state machine, which is what it is: the same
        // key appended twice must keep both and in order, `set` must collapse
        // them to one *in the first one's position*, `sort` must be stable
        // across equal keys, and `delete` must take every match. None of that
        // is reachable by constructing one and reading it back, and none of it
        // was compared -- the corpus reached 8 of `url`'s 14 functions.
        //
        // The serialisation is compared at every step, because the ordering
        // *is* the behaviour: two implementations can agree on `getAll` and
        // disagree on `toString`.
        label: "searchparams-program",
        call: (m, seed) => {
          let sp;
          try {
            sp = new m.URLSearchParams(seed);
          } catch (e) {
            return `CONSTRUCT:${(e && e.code) || (e && e.name)}`;
          }
          const out = [`init:${sp.toString()}`, `size:${sp.size}`];
          const key = seed.length > 0 ? seed[0] : "k";
          try {
            sp.append(key, "1");
            out.push(`append1:${sp.toString()}`);
            sp.append(key, "2");
            out.push(`append2:${sp.toString()}`);
            out.push(`getAll:${JSON.stringify(sp.getAll(key))}`);
            out.push(`get:${JSON.stringify(sp.get(key))}`);
            out.push(`has:${sp.has(key)}`);
            sp.set(key, "3");
            out.push(`set:${sp.toString()}`);
            sp.sort();
            out.push(`sort:${sp.toString()}`);
            sp.delete(key);
            out.push(`delete:${sp.toString()}`, `sizeAfter:${sp.size}`);
            out.push(`keys:${JSON.stringify([...sp.keys()])}`);
            out.push(`entries:${JSON.stringify([...sp.entries()])}`);
          } catch (e) {
            out.push(`THREW:${(e && e.code) || (e && e.name)}`);
          }
          return out;
        },
      },
      {
        // `domainToASCII` and `domainToUnicode` are pure string functions over
        // IDNA, and answer `''` rather than throwing on input they cannot
        // convert -- a reimplementation that throws instead is a difference no
        // pinned test reaches.
        label: "domainTo",
        call: (m, s2) => {
          const a = m.domainToASCII(s2);
          const u = m.domainToUnicode(s2);
          return [a, u, a === "" ? "empty" : "converted"];
        },
      },

      { name: "parse", args: (s) => [s] },
      { name: "format", args: (s) => [s] },
      { name: "resolve", args: (s) => ["http://base.example/x/y", s] },
      { name: "domainToASCII", args: (s) => [s] },
      { name: "domainToUnicode", args: (s) => [s] },
      // The file-URL pair, which is this lane's own and is where percent
      // encoding, a leading slash and a Windows drive letter all interact.
      {
        label: "pathToFileURL",
        call: (m, s) => {
          try {
            return m.pathToFileURL(s).href;
          } catch (error) {
            return `threw ${error.name}: ${error.code ?? ""}`;
          }
        },
      },
      {
        label: "fileURLToPath",
        call: (m, s) => {
          try {
            return m.fileURLToPath(`file://${s}`);
          } catch (error) {
            return `threw ${error.name}: ${error.code ?? ""}`;
          }
        },
      },
      {
        label: "urlToHttpOptions",
        call: (m, s) => {
          try {
            return JSON.stringify(m.urlToHttpOptions(new URL(`http://h/${s}`)));
          } catch (error) {
            return `threw ${error.name}: ${error.code ?? ""}`;
          }
        },
      },
    ],
  },

  querystring: {
    // The token list is the point: `__proto__` in a query is the case that was
    // wrong, and it only shows up if a generator can put it anywhere.
    fixed: [
      "", "a", "a=1", "a=1&b=2", "__proto__", "a&__proto__", "__proto__&a",
      "a&__proto__&b", "a=1&__proto__=2&b=3", "%", "%zz", "%20", "+", "=",
      "&&&", "a=1&a=2", "a[]=1", "ü=日", "%C3%BC=%E4%B8%AD",
    ],
    input: (rnd) => {
      const TOK = ["a", "b", "=", "&", "%20", "%", "%zz", "+", "", "ü", "日",
        "%C3%BC", ";", "[]", "a[]", "__proto__", "0", "null", "%E4%B8%AD", "#", "?"];
      let s = "";
      const k = 1 + Math.floor(rnd() * 8);
      for (let j = 0; j < k; j++) s += choose(rnd, TOK);
      return s;
    },
    calls: [
      { name: "parse", args: (s) => [s] },
      { name: "escape", args: (s) => [s] },
      { name: "unescape", args: (s) => [s] },
      { name: "stringify", args: (s) => [{ [s]: "v", other: ["1", "2"] }] },
      // `encode` and `decode` are node's documented aliases for `stringify` and
      // `parse`, and `unescapeBuffer` is the safe fast decoder `unescape` falls
      // back to. None were compared -- the corpus reached 4 of 7 functions, and
      // an alias that stops aliasing is exactly the kind of break no pinned
      // test catches.
      { name: "decode", args: (s) => [s] },
      { name: "encode", args: (s) => [{ [s]: "v", other: ["1", "2"] }] },
      {
        label: "unescapeBuffer",
        call: (m, s) => {
          const b = m.unescapeBuffer(s, false);
          return [b.length, b.toString("latin1")];
        },
      },
    ],
  },

  dgram: {
    // `createSocket`'s validation, which happens before any socket exists and
    // is therefore comparable. A bad type, a bad options object, a missing
    // type -- all answer synchronously with a code, and none of them binds
    // anything.
    //
    // Every socket that *is* created here is closed immediately. A corpus that
    // leaks handles keeps the process alive and the run never ends.
    fixed: [
      "udp4", "udp6", "UDP4", "udp", "", "tcp", "udp4 ", "0", "null",
      "undefined", "{}", "o:udp4", "o:udp6", "o:bogus", "o:", "o:none",
      "o:udp4+reuse", "o:udp4+ipv6only", "o:udp4+recvbuf", "o:udp4+badlookup",
    ],
    input: (rnd) => {
      const T = ["udp4", "udp6", "UDP4", "udp", "", "tcp", "0", "o:udp4", "o:udp6", "o:bogus", "o:", "o:udp4+reuse", "o:udp4+badlookup", "o:none"];
      return T[Math.floor(rnd() * T.length)];
    },
    calls: (() => {
      // One socket for the whole run, bound once and unreffed. See `http`'s corpus for why both
      // matter: ~4,000 binds per side would dominate the run, and a bound handle keeps the probe's
      // child alive after it has printed its answer.
      let shared = null;
      const socketFor = async (m) => {
        if (shared !== null) return shared;
        const socket = m.createSocket({ type: "udp4", reuseAddr: true });
        await new Promise((resolve, reject) => {
          socket.once("error", reject);
          socket.bind(0, "127.0.0.1", resolve);
        });
        socket.unref();
        shared = { socket, port: socket.address().port };
        return shared;
      };
      return [
        {
          // **The `Socket` half of `dgram`, which was 2 of 31 published functions.** Everything
          // uncalled was an instance method: `bind`, `send`, `address`, the TTL and buffer-size
          // setters, membership, `connect`/`disconnect`. A datagram sent to the socket's own port
          // is a value -- the bytes arrive or they do not -- so this is a value compare and not
          // an ordering one.
          //
          // Ports are never compared; the two sides bind different ones. What is compared is the
          // payload, the address *family*, what the getters answer after the setters, and the
          // codes the membership calls produce for an address that is not multicast.
          label: "socket-round-trip",
          call: async (m, s) => {
            const attempt = (make) => {
              try {
                const v = make();
                return v === undefined ? "ok" : String(v);
              } catch (error) {
                return `${error?.code ?? error?.name ?? "?"}`;
              }
            };
            try {
              const { socket, port } = await socketFor(m);
              const payload = Buffer.from(String(s), "utf8");
              const echoed = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve("timeout"), 2000);
                const onMessage = (message, rinfo) => {
                  clearTimeout(timer);
                  socket.removeListener("message", onMessage);
                  resolve(`${message.equals(payload) ? "same" : `differs:${message.length}`}~${rinfo.family}~${rinfo.size}`);
                };
                socket.on("message", onMessage);
                socket.send(payload, port, "127.0.0.1", (error) => {
                  if (error) {
                    clearTimeout(timer);
                    socket.removeListener("message", onMessage);
                    resolve(`send:${error.code ?? error.name}`);
                  }
                });
              });
              return [
                echoed,
                socket.address().family,
                // The setters answer nothing; the getters are what can be compared. A size is
                // rounded by the kernel, so the comparison is that both sides round the same way.
                attempt(() => socket.setTTL(64)),
                attempt(() => socket.setBroadcast(false)),
                attempt(() => socket.setMulticastTTL(1)),
                attempt(() => socket.setMulticastLoopback(false)),
                attempt(() => socket.setRecvBufferSize(8192)),
                attempt(() => socket.getRecvBufferSize()),
                attempt(() => socket.setSendBufferSize(8192)),
                attempt(() => socket.getSendBufferSize()),
                attempt(() => socket.getSendQueueSize()),
                attempt(() => socket.getSendQueueCount()),
                // An address that is not multicast: both sides must refuse it the same way.
                attempt(() => socket.addMembership("127.0.0.1")),
                attempt(() => socket.dropMembership("127.0.0.1")),
                attempt(() => socket.setMulticastInterface("0.0.0.0")),
                // `remoteAddress` before a connect is an error, and its family after one is
                // comparable where its port is not.
                attempt(() => socket.remoteAddress()),
                // **`ref()` then `unref()`, in that order, and the order is load-bearest.**
                // Calling `ref()` alone undoes the `unref()` this corpus does after binding, so
                // from the first input onward the socket held the probe's child alive and
                // `spawnSync` waited forever. Ten minutes of nothing, from one method call that
                // does exactly what it says.
                attempt(() => { socket.ref(); socket.unref(); return "ok"; }),
              ].join("|");
            } catch (error) {
              return `threw:${error?.code ?? error?.name ?? "?"}`;
            }
          },
        },

      {
        label: "createSocket",
        call: (m, spec) => {
          let arg;
          if (spec.startsWith("o:")) {
            const rest = spec.slice(2);
            const [type, flag] = rest.split("+");
            arg = {};
            if (type !== "none") arg.type = type === "" ? "" : type;
            if (flag === "reuse") arg.reuseAddr = true;
            if (flag === "ipv6only") arg.ipv6Only = true;
            if (flag === "recvbuf") arg.recvBufferSize = 1024;
            if (flag === "badlookup") arg.lookup = 42;
          } else if (spec === "null") {
            arg = null;
          } else if (spec === "undefined") {
            arg = undefined;
          } else if (spec === "{}") {
            arg = {};
          } else {
            arg = spec;
          }
          let sock;
          try {
            sock = m.createSocket(arg);
          } catch (e) {
            return `${(e && e.code) || "?"}:${(e && e.name) || "?"}`;
          }
          try {
            // Never left open: an unclosed handle keeps the process alive and
            // the sweep never finishes.
            const type = sock.type;
            sock.close();
            return `ok:${type}`;
          } catch (e) {
            return `ok-then:${(e && e.code) || (e && e.name)}`;
          }
        },
      },
    ];
    })(),
  },
  timers: {
    // The synchronous surface of a timer: what `setTimeout` validates before
    // scheduling, and what the handle it returns answers immediately.
    // `hasRef()`, `ref()`/`unref()` returning the handle itself, and
    // `refresh()` are all answerable without the timer ever firing.
    //
    // **The firing is not compared here.** Ordering between timers is
    // `fuzz-timer-order.mjs`'s question and needs a clock, not a value compare.
    // Every timer created is cleared in the same call.
    //
    // `Symbol.toPrimitive` was probed here and has been removed. It is a real
    // difference -- node's `Timeout` carries it and answers the timer id, ours
    // does not -- and it is **deliberately out of scope**: §13 lists
    // `Symbol.toPrimitive` as an excluded runtime operation hook, and
    // `test-timers-to-primitive.js` is marked not applicable for exactly that
    // reason. Keeping the probe would report 8 divergences on every run for a
    // decision already made, which trains a reader to ignore the number. The
    // difference is recorded in `docs/conformance/nodejs.md` instead.
    fixed: [
      "fn|0", "fn|1", "fn|-1", "fn|N", "fn|I", "fn|2147483648", "fn|1.5",
      "fn|", "fn|s", "no|0", "str|0", "obj|0", "num|0", "undef|0",
      "fn|0|ref", "fn|0|unref", "fn|0|hasRef", "fn|0|refresh", "fn|1e21", "fn|0|hasRef",
    ],
    input: (rnd) => {
      const CB = ["fn", "no", "str", "obj", "num", "undef"];
      const D = ["0", "1", "-1", "N", "I", "1.5", "2147483648", "", "s", "1e21"];
      const OP = ["", "|ref", "|unref", "|hasRef", "|refresh"];
      return `${CB[Math.floor(rnd() * CB.length)]}|${D[Math.floor(rnd() * D.length)]}${OP[Math.floor(rnd() * OP.length)]}`;
    },
    calls: [
      // Error paths. See `REJECTED` above: the generated inputs are ones these
      // functions accept, so nothing here reached a validation branch until
      // these were added, and the `code` node's own suite asserts on was never
      // compared. `throws: true` tells the harness node is expected to reject,
      // and it holds those specs to the mirror of its typo guard -- node must
      // throw a *coded* error, which an undefined-property typo does not.
      { label: "setTimeout!", throws: true, call: (m, s) => m.setTimeout(rejected(s)) },
      { label: "setInterval!", throws: true, call: (m, s) => m.setInterval(rejected(s)) },
      {
        // `setInterval` and `setImmediate` have the same synchronous surface as
        // `setTimeout` and were not being compared at all -- the corpus reached
        // 2 of `timers`' 6 functions. Each handle is cleared in the same call;
        // an interval left running keeps the process alive and the sweep never
        // ends.
        label: "setInterval-surface",
        call: (m, spec) => {
          const [cbKind, delayText] = spec.split("|");
          const cb = cbKind === "fn" ? () => {} : cbKind === "str" ? "no" : undefined;
          const delay =
            delayText === "" ? undefined
            : delayText === "N" ? NaN
            : delayText === "I" ? Infinity
            : delayText === "s" ? "later"
            : Number(delayText);
          let h;
          try {
            h = m.setInterval(cb, delay);
          } catch (e) {
            return `${(e && e.code) || "?"}:${(e && e.name) || "?"}`;
          }
          const out = ["scheduled", `hasRef:${h.hasRef()}`, `unref-self:${h.unref() === h}`];
          m.clearInterval(h);
          return out;
        },
      },
      {
        label: "setImmediate-surface",
        call: (m, spec) => {
          const cbKind = spec.split("|")[0];
          const cb = cbKind === "fn" ? () => {} : cbKind === "str" ? "no" : undefined;
          let h;
          try {
            h = m.setImmediate(cb);
          } catch (e) {
            return `${(e && e.code) || "?"}:${(e && e.name) || "?"}`;
          }
          const out = ["scheduled", `hasRef:${h.hasRef()}`, `ref-self:${h.ref() === h}`];
          m.clearImmediate(h);
          return out;
        },
      },
      {
        label: "setTimeout-surface",
        call: (m, spec) => {
          const [cbKind, delayText, op] = spec.split("|");
          const cb =
            cbKind === "fn" ? () => {}
            : cbKind === "str" ? "notafunction"
            : cbKind === "obj" ? {}
            : cbKind === "num" ? 42
            : cbKind === "undef" ? undefined
            : null;
          const delay =
            delayText === "" ? undefined
            : delayText === "N" ? NaN
            : delayText === "I" ? Infinity
            : delayText === "s" ? "later"
            : Number(delayText);
          let handle;
          try {
            handle = m.setTimeout(cb, delay);
          } catch (e) {
            return `${(e && e.code) || "?"}:${(e && e.name) || "?"}`;
          }
          const out = ["scheduled"];
          try {
            if (op === "ref") out.push(`ref-self:${handle.ref() === handle}`);
            else if (op === "unref") out.push(`unref-self:${handle.unref() === handle}`);
            else if (op === "hasRef") out.push(`hasRef:${handle.hasRef()}`);
            else if (op === "refresh") out.push(`refresh-self:${handle.refresh() === handle}`);
          } catch (e) {
            out.push(`op-threw:${(e && e.code) || (e && e.name)}`);
          }
          m.clearTimeout(handle);
          return out;
        },
      },
    ],
  },
  http: {
    // The pure surface of `http`: two header validators and two tables. Header
    // *validation* is a token grammar with no I/O -- RFC 7230 `token` for a
    // name, and a value that may not carry a control character or a bare CR or
    // LF -- and it is the part of `http` most likely to be almost right.
    //
    // These matter beyond conformance: `validateHeaderValue` is what stops
    // response splitting, so a reimplementation that accepts a bare `\r\n`
    // where node rejects it is a security difference and not a cosmetic one.
    // Both the accept/reject decision and the error `code` are compared.
    //
    // Excluded: every part of `http` that speaks to a socket. This corpus is
    // the part that does not, named as such rather than left implied.
    fixed: [
      "X-Test", "x-test", "", " ", "X Test", "X:Test", "X\tTest", "X\rTest",
      "X\nTest", "X\r\nTest", "Content-Length", "content_length", "a".repeat(200),
      "ünicode", "X-é", "\u0000", "X\u0000", "1", "-", "!#$%&'*+.^_`|~",
      "(", ")", "<", ">", "@", ",", ";", "\\", '"', "/",
      "[", "]", "?", "=", "{", "}", "X-Test ", " X-Test", "X-Té st",
    ],
    input: (rnd) => {
      const CHARS = "abcXY-_.!#$%&'*+^`|~ \t\r\n:;,()<>@[]?={}\\\"/0\u0000\u00e9\u4e2d";
      let out = "";
      const k = Math.floor(rnd() * 12);
      for (let i = 0; i < k; i++) out += CHARS[Math.floor(rnd() * CHARS.length)];
      return out;
    },
    calls: (() => {
      // **One server for the whole run, not one per input.** The corpus drives ~4,000 inputs
      // through every spec; a server and a `listen` each time would be ~4,000 listens per side
      // and would dominate the run. This is created on first use and outlives the process, which
      // is the same reason `fs`'s corpus resolves its base path once in this position.
      // **And one keep-alive agent, for the same reason.** A fresh connection per request put
      // this spec over a ten-minute timeout on its first run: ~4,000 inputs is ~4,000 TCP
      // handshakes and teardowns per side. Reusing the socket is what makes the spec affordable,
      // and it is also closer to what an HTTP client does.
      let shared = null;
      const serverFor = async (m) => {
        if (shared !== null) return shared;
        const server = m.createServer((request, response) => {
          const body = [];
          request.on("data", (chunk) => body.push(chunk));
          request.on("end", () => {
            // Echo what arrived, and report what the server saw of the request line. `Date` is
            // never compared -- it is the one response header that differs between two runs of
            // the same program, let alone two implementations.
            response.setHeader("X-Seen-Method", request.method);
            response.setHeader("X-Seen-Version", request.httpVersion);
            response.writeHead(200, { "Content-Type": "text/plain" });
            response.end(Buffer.concat(body));
          });
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        // **Unreffed, or the process never exits and the host waits on it forever.** The probe
        // computes this profile's side in a child and `differential-ts.mjs` reads it with
        // `spawnSync`; a listening server keeps that child's loop alive after the answer has
        // been printed. The first run of this spec hit the ten-minute timeout with nothing
        // wrong but that.
        server.unref();
        shared = {
          server,
          port: server.address().port,
          agent: new m.Agent({ keepAlive: true, maxSockets: 1 }),
        };
        return shared;
      };
      return [
        {
          // **The socket half of `http`, which this corpus excluded by construction.** The note
          // above says "every part of `http` that speaks to a socket" is out, and that was a
          // statement about the harness rather than about the module: a request is asynchronous
          // and `differential-ts.mjs` could not await until 2026-09-14. `corpus-reach.mjs` had
          // this module at **2 of 78** published functions, the lowest in the tree.
          //
          // What is compared is deterministic: the status line, the body that came back, the
          // headers the server reported seeing, and the ones it set. Ports are never compared --
          // the two sides listen on different ones by definition -- and neither is `Date`.
          label: "request-round-trip",
          call: async (m, s) => {
            try {
              const { port, agent } = await serverFor(m);
              const payload = Buffer.from(String(s), "utf8");
              return await new Promise((resolve) => {
                const request = m.request(
                  { host: "127.0.0.1", port, method: "POST", path: "/echo", agent },
                  (response) => {
                    const chunks = [];
                    response.on("data", (chunk) => chunks.push(chunk));
                    response.on("end", () => {
                      const body = Buffer.concat(chunks);
                      const names = Object.keys(response.headers)
                        .filter((name) => name !== "date")
                        .sort()
                        .join(",");
                      resolve([
                        response.statusCode,
                        response.statusMessage,
                        response.httpVersion,
                        names,
                        response.headers["content-type"],
                        response.headers["x-seen-method"],
                        response.headers["x-seen-version"],
                        body.equals(payload) ? "echoed" : `differs:${body.length}/${payload.length}`,
                      ].join("~"));
                    });
                  },
                );
                request.on("error", (error) => resolve(`threw:${error.code ?? error.name}`));
                request.end(payload);
              });
            } catch (error) {
              return `threw:${error.code ?? error.name ?? "?"}`;
            }
          },
        },

      // Error paths. See `REJECTED` above.
      { label: "validateHeaderName!", throws: true, call: (m, s) => m.validateHeaderName(`bad header ${String(s).length}`) },
      {
        label: "validateHeaderName",
        call: (m, s) => {
          try {
            m.validateHeaderName(s);
            return "accepted";
          } catch (e) {
            return `${(e && e.code) || "?"}:${(e && e.name) || "?"}`;
          }
        },
      },
      {
        label: "validateHeaderValue",
        call: (m, s) => {
          try {
            m.validateHeaderValue("X-Fixed", s);
            return "accepted";
          } catch (e) {
            return `${(e && e.code) || "?"}:${(e && e.name) || "?"}`;
          }
        },
      },
      {
        // `STATUS_CODES` whole, once per input rather than per key: 63 entries of
        // prose, and a missing or misspelled one is invisible to every pinned test
        // that does not happen to use that code.
        label: "statusCodes",
        call: (m) => [
          Object.keys(m.STATUS_CODES).length,
          m.STATUS_CODES[200],
          m.STATUS_CODES[404],
          m.STATUS_CODES[418],
          m.STATUS_CODES[451],
        ],
      },
      {
        // **Split from `STATUS_CODES`, and the split is the point.** These were one
        // spec called `tables`, and `publishes()` skips a spec whose export the
        // addon lacks -- so bundling two exports means the compiled lane compares
        // *neither* when it publishes only one. `http` began publishing `METHODS`
        // when its `module#init` started running and the compiled differential went
        // on reporting NOTHING WAS COMPARED, because `STATUS_CODES` was in the same
        // call.
        //
        // A spec is the unit of skipping, so a spec should reach one export.
        label: "methods",
        call: (m) => [
          Array.isArray(m.METHODS) ? m.METHODS.length : "not-array",
          Array.isArray(m.METHODS) ? m.METHODS.join(",") : "",
        ],
      },
      {
        // A number, and one node's own tests read: `--max-http-header-size` moves
        // it, so a wrong default is a wrong parse limit rather than a wrong field.
        label: "maxHeaderSize",
        call: (m) => m.maxHeaderSize,
      },

      // **The rest of `http`'s value-shaped surface**, which was 35 of 78 published
      // functions and is mostly `OutgoingMessage`.
      //
      // The header above covers two validators and two tables, and the reason the
      // rest sat uncompared is that `http` reads as a module about connections. Most
      // of it is not: an `OutgoingMessage` built with `new` and never attached to a
      // socket answers every header question synchronously, and header *bookkeeping*
      // is the part of `http` a caller touches most and the part most likely to be
      // almost right -- case folding, which spellings survive, whether a second
      // `setHeader` replaces or appends, and what `getRawHeaderNames` remembers.
      //
      // Nothing here listens or connects. `ClientRequest` and `WebSocket` are not
      // here for exactly that reason: constructing either opens a socket, and the
      // nine `ClientRequest` methods and two `WebSocket` methods need a live peer to
      // answer about rather than a shape. They stay uncalled, named here so the gap
      // is a decision.
      {
        // `OutgoingMessage`'s header bookkeeping, detached.
        //
        // The return values are compared by **identity against the message**, never
        // by stringifying them: these methods answer `this`, and `JSON.stringify` on
        // an `OutgoingMessage` is 30 internal fields including `_events`, which is a
        // shape rather than an answer and would bury the row it is in.
        label: "outgoing-headers",
        call: (m, s) => {
          const out = [];
          const message = new m.OutgoingMessage();
          const attempt = (label, fn) => {
            try {
              const got = fn();
              out.push(`${label}:ok:${got === message ? "self" : got === undefined ? "void" : typeof got === "object" && got !== null ? JSON.stringify(got) : String(got)}`);
            } catch (error) {
              out.push(`${label}:${error.code ?? error.name}`);
            }
          };
          // Names drawn from the input, so the case folding and the token grammar are
          // exercised by what the corpus generates rather than by a fixed list.
          const raw = s.replace(/[^\x21-\x7e]/g, "") || "X-Nts";
          const name = raw.slice(0, 20);
          const mixed = `${name.toUpperCase()}`;

          attempt("setHeader", () => message.setHeader(name, "1"));
          attempt("hasHeaderExact", () => message.hasHeader(name));
          attempt("hasHeaderLower", () => message.hasHeader(name.toLowerCase()));
          attempt("hasHeaderUpper", () => message.hasHeader(mixed));
          attempt("getHeader", () => message.getHeader(name.toLowerCase()));
          attempt("getHeaderNames", () => JSON.stringify(message.getHeaderNames()));
          attempt("getRawHeaderNames", () => JSON.stringify(message.getRawHeaderNames()));
          attempt("getHeaders", () => JSON.stringify(message.getHeaders()));

          // A second `setHeader` under a different spelling: node replaces, keeping the
          // *new* raw spelling, which `getRawHeaderNames` is the only way to see.
          attempt("setHeaderAgain", () => message.setHeader(mixed, "2"));
          attempt("afterAgain", () =>
            `${JSON.stringify(message.getHeaders())}|${JSON.stringify(message.getRawHeaderNames())}`);

          // `appendHeader` accumulates where `setHeader` replaces, and only for the
          // headers node allows more than one of.
          attempt("appendHeaderNew", () => message.appendHeader("X-Multi", `a${s.length % 5}`));
          attempt("appendHeaderSame", () => message.appendHeader("x-multi", "b"));
          attempt("appendedValue", () => JSON.stringify(message.getHeader("X-MULTI")));
          attempt("appendHeaderOnSet", () => message.appendHeader(name, "3"));
          attempt("afterAppendOnSet", () => JSON.stringify(message.getHeader(name)));

          // `setHeaders` takes a `Map` or a `Headers`, and rejects a plain object --
          // which is the mistake everybody makes with it.
          attempt("setHeadersMap", () =>
            message.setHeaders(new Map([["x-map", `${s.length % 7}`], ["X-Map2", "y"]])));
          attempt("afterSetHeaders", () => JSON.stringify(message.getHeaders()));
          for (const bad of [{ "x-obj": "1" }, null, undefined, 1, "x", []]) {
            attempt(`setHeadersBad:${Array.isArray(bad) ? "array" : bad === null ? "null" : typeof bad}`,
              () => message.setHeaders(bad));
          }

          attempt("removeHeader", () => message.removeHeader(mixed));
          attempt("afterRemove", () =>
            `${JSON.stringify(message.getHeaderNames())}|${message.hasHeader(name)}`);
          attempt("removeUnknown", () => message.removeHeader("x-never-set"));
          attempt("_renderHeaders", () => JSON.stringify(message._renderHeaders()));

          // The names node refuses outright, and the ones it refuses only in a
          // particular position.
          for (const bad of ["", " ", "x y", "x:y", `x${String.fromCharCode(10)}y`, "ü"]) {
            attempt(`setHeaderBadName:${JSON.stringify(bad)}`, () => message.setHeader(bad, "v"));
            attempt(`getHeaderBadName:${JSON.stringify(bad)}`, () => String(message.getHeader(bad)));
          }
          for (const bad of [undefined, null, {}, `v${String.fromCharCode(13)}w`]) {
            attempt(`setHeaderBadValue:${String(bad)}`, () => message.setHeader("X-Ok", bad));
          }

          attempt("cork", () => message.cork());
          attempt("uncork", () => message.uncork());
          attempt("addTrailers", () => message.addTrailers({ "X-Trailer": `t${s.length % 3}` }));
          attempt("addTrailersMap", () => message.addTrailers(new Map([["x-t2", "u"]])));
          attempt("setTimeout", () => message.setTimeout(1000 + (s.length % 50)));
          attempt("setTimeoutZero", () => message.setTimeout(0));

          // The three the base class leaves unimplemented, which is how a subclass that
          // forgot one fails.
          attempt("_implicitHeader", () => message._implicitHeader());
          attempt("flushHeaders", () => message.flushHeaders());
          attempt("write", () => message.write("x"));

          // `pipe` on an outgoing message refuses outright: there is nothing to read
          // from one. Synchronous, unlike `Writable#pipe` in `stream`, which answers the
          // destination and then emits the same code a tick later.
          for (const destination of [{}, null, undefined]) {
            attempt(`pipe:${destination === null ? "null" : typeof destination}`, () =>
              message.pipe(destination));
          }

          attempt("destroy", () => message.destroy());
          out.push(`destroyed:${message.destroyed}|writable:${message.writable}` +
            `|headersSent:${message.headersSent}`);
          // Every header call again, now that the message is destroyed.
          attempt("afterDestroy:setHeader", () => message.setHeader("X-After", "1"));
          attempt("afterDestroy:getHeaders", () => JSON.stringify(message.getHeaders()));
          return out.join("\n");
        },
      },
      {
        // `ServerResponse`'s informational writes and `IncomingMessage`'s two
        // internals, both detached.
        //
        // The informational responses go **first**, before `_implicitHeader`: once the
        // head is rendered node answers `ERR_HTTP_HEADERS_SENT` to all four, so
        // calling them afterwards compares one error four times and says nothing about
        // what any of them does.
        label: "http-response-and-incoming",
        call: (m, s) => {
          const out = [];
          const attempt = (label, fn) => {
            try {
              const got = fn();
              out.push(`${label}:ok:${got === undefined ? "void" : typeof got === "object" && got !== null ? "object" : String(got)}`);
            } catch (error) {
              out.push(`${label}:${error.code ?? error.name}`);
            }
          };
          const fresh = () => new m.ServerResponse({
            method: s.length % 2 === 0 ? "GET" : "HEAD",
            httpVersionMajor: 1,
            httpVersionMinor: 1,
          });

          // Each on its own response, so the first does not decide the rest.
          for (const [name, run] of [
            ["writeContinue", (res) => res.writeContinue()],
            ["writeProcessing", (res) => res.writeProcessing()],
            ["writeEarlyHints", (res) => res.writeEarlyHints({ link: "</a>; rel=preload" })],
            ["writeInformation", (res) => (typeof res.writeInformation === "function"
              ? res.writeInformation(103)
              : "ABSENT")],
          ]) {
            const res = fresh();
            attempt(name, () => run(res));
            try { res.destroy(); } catch { /* recorded above if it matters */ }
          }
          // And the same four after the head is rendered, which is the other half of
          // their contract.
          const rendered = fresh();
          attempt("_implicitHeader", () => rendered._implicitHeader());
          attempt("afterHead:writeContinue", () => rendered.writeContinue());
          attempt("afterHead:writeEarlyHints", () => rendered.writeEarlyHints({}));
          attempt("headerRendered", () => typeof rendered._header === "string");
          try { rendered.destroy(); } catch { /* not the subject */ }

          const incoming = new m.IncomingMessage();
          // **`setTimeout` is not called on it**, and node's answer is why.
          //
          // Node's is `this.socket.setTimeout(msecs)` with no guard, so on a message
          // that has no socket -- which is only reachable by constructing one by hand,
          // as here -- it raises a bare `TypeError` from dereferencing `null`. This
          // profile guards and answers the message.
          //
          // Matching node would mean reproducing an unguarded dereference, and the case
          // does not arise in a real request: an `IncomingMessage` the server hands you
          // always has a socket. So ours stays, and the row is recorded rather than
          // compared -- the same call as `stream.addAbortSignal(null, ...)`, where node's
          // error is an accident of `'aborted' in null` rather than a decision.
          attempt("inc._addHeaderLineDistinct", () =>
            incoming._addHeaderLineDistinct("set-cookie", `a=${s.length % 9}`, incoming.headers));
          attempt("inc._addHeaderLineDistinctTwice", () =>
            incoming._addHeaderLineDistinct("set-cookie", "b=2", incoming.headers));
          attempt("inc.headers", () => JSON.stringify(incoming.headers));
          attempt("inc._dumpAndCloseReadable", () => incoming._dumpAndCloseReadable());

          // `MessageEvent` and its legacy initialiser, which `http` republishes for the
          // WebSocket surface. `initMessageEvent` predates constructor arguments and is
          // kept for compatibility -- it mutates an already-built event, which is the
          // part worth comparing.
          try {
            const event = new m.MessageEvent(`msg${s.length % 3}`, { data: `d${s.length % 5}` });
            out.push(`event:${event.type}|${String(event.data)}|${event.bubbles}|${event.cancelable}`);
            const returned = event.initMessageEvent(
              "changed", true, true, `later${s.length % 4}`, "origin", "lastId",
            );
            out.push(`initMessageEvent:${returned === undefined ? "void" : typeof returned}` +
              `|${event.type}|${String(event.data)}|${event.bubbles}|${event.cancelable}` +
              `|${event.origin}|${event.lastEventId}`);
          } catch (error) {
            out.push(`MessageEvent:${error.code ?? error.name}`);
          }
          return out.join("\n");
        },
      },
      {
        // A `Server` that never listened, an `Agent`, and the two module-level
        // setters.
        //
        // `setGlobalProxyFromEnv` reads the environment and configures the global
        // agent from it. With no proxy variables set there is nothing for it to do,
        // which is why it is safe to call -- and that makes its answer a fact about
        // the environment rather than about the input, so what is compared is only
        // that it accepts no arguments and answers `undefined`. Said plainly because
        // a row that cannot vary is worth less than it looks.
        label: "http-server-and-agent",
        call: async (m, s) => {
          const out = [];
          const attempt = (label, fn) => {
            try {
              const got = fn();
              out.push(`${label}:ok:${got === undefined ? "void" : typeof got === "object" && got !== null ? "object" : String(got)}`);
            } catch (error) {
              out.push(`${label}:${error.code ?? error.name}`);
            }
          };
          const server = new m.Server();
          server.on("error", () => {});
          attempt("setTimeout", () => server.setTimeout(1000 + (s.length % 40)));
          attempt("closeIdleConnections", () => server.closeIdleConnections());
          attempt("closeAllConnections", () => server.closeAllConnections());
          out.push(`close:${await new Promise((resolve) => {
            try {
              server.close((error) => resolve(error ? `cb:${error.code ?? error.name}` : "ok"));
            } catch (error) {
              resolve(`threw:${error.code ?? error.name}`);
            }
          })}`);

          const agent = new m.Agent({ keepAlive: s.length % 2 === 0, maxSockets: 1 + (s.length % 4) });
          attempt("agent.destroy", () => agent.destroy());
          attempt("agent.destroyTwice", () => agent.destroy());

          for (const count of [1 + (s.length % 8), 0, -1, 1.5, "4", null]) {
            attempt(`setMaxIdleHTTPParsers:${String(count)}`, () => m.setMaxIdleHTTPParsers(count));
          }
          // Put it back, because it is process-wide.
          attempt("setMaxIdleHTTPParsersRestore", () => m.setMaxIdleHTTPParsers(1000));

          attempt("setGlobalProxyFromEnv", () =>
            typeof m.setGlobalProxyFromEnv === "function"
              ? m.setGlobalProxyFromEnv()
              : "ABSENT");

          // `_connectionListener` expects a socket. Everything here is not one, so it
          // reports rather than wiring anything up.
          for (const bad of [null, undefined, 1, {}, "socket"]) {
            attempt(`_connectionListener:${bad === null ? "null" : typeof bad}`, () =>
              m._connectionListener(bad));
          }
          return out.join("\n");
        },
      },
    ];
    })(),
  },
  net: {
    // The pure surface of `net`, which I first dismissed as "sockets answer
    // over time" and then found is three address parsers and a value-shaped
    // class. `isIP`, `isIPv4` and `isIPv6` take a string and answer a number or
    // a boolean with no I/O at all, and an address parser is exactly the kind
    // of thing a reimplementation gets almost right.
    //
    // The edges that matter and that no pinned test sweeps: leading zeros
    // (`01.2.3.4`), a trailing dot, `::` in every position, an IPv4-mapped
    // IPv6 address, a zone id (`%eth0`), more than eight groups, an empty
    // group, and full-width digits.
    //
    // Excluded: `connect`, `createServer`, `Socket` and everything else on the
    // module. They answer over time to a peer and belong to a different
    // harness. This corpus covers the part that does not, and says so.
    fixed: [
      "", "0", "1.2.3.4", "01.2.3.4", "1.2.3.4.", "1.2.3", "1.2.3.4.5",
      "255.255.255.255", "256.1.1.1", "-1.2.3.4", "1.2.3.04", " 1.2.3.4",
      "::", "::1", "1::", "::ffff:1.2.3.4", "1:2:3:4:5:6:7:8",
      "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7", "fe80::1%eth0", "::%1",
      "1::2::3", "gggg::1", "0:0:0:0:0:0:0:0", "２.２.２.２", "1.2.3.4/24",
      "[::1]", "1.2.3.4:80", "\t1.2.3.4", "1.2.3.4\n",
    ],
    input: (rnd) => {
      const PARTS = ["1", "0", "01", "255", "256", "-1", "a", "", "ffff", "::", ":", ".", "%eth0", "g", "２"];
      const sep = rnd() < 0.5 ? "." : ":";
      let out = "";
      const k = 1 + Math.floor(rnd() * 8);
      for (let i = 0; i < k; i++) {
        out += PARTS[Math.floor(rnd() * PARTS.length)];
        if (i < k - 1 && rnd() < 0.8) out += sep;
      }
      return out;
    },
    calls: (() => {
      // One echo server and one keep-alive-free client per input, with the server created once.
      // See `http`'s corpus above for why both of those matter: ~4,000 listens per side is the
      // difference between eight seconds and a timeout, and an un-unreffed server keeps the
      // probe's child alive after it has printed its answer.
      let shared = null;
      const serverFor = async (m) => {
        if (shared !== null) return shared;
        // **Echo on `end`, not on `data`.** Keyed off `data`, an empty input produces no event
        // at all: the server never replies, the client never closes, and the run hangs rather
        // than reporting anything. `net`'s generated inputs include `""`, so this was not a
        // corner case -- it was the first one.
        const server = m.createServer((socket) => {
          const chunks = [];
          socket.on("data", (chunk) => chunks.push(chunk));
          socket.on("end", () => socket.end(Buffer.concat(chunks)));
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        server.unref();
        shared = { server, port: server.address().port };
        return shared;
      };
      return [
        {
          // **The socket half of `net`.** This corpus opens by saying sockets "answer over time"
          // and keeping to the three address parsers, which was right while the harness was
          // synchronous. A single echo exchange is a *value*: the bytes that came back, and the
          // counters and address fields the socket reports afterwards.
          //
          // Ports are never compared -- the two sides listen on different ones. Neither is
          // `localPort`, for the same reason.
          label: "echo-round-trip",
          call: async (m, s) => {
            try {
              const { port } = await serverFor(m);
              const payload = Buffer.from(String(s), "utf8");
              return await new Promise((resolve) => {
                // A deadline, so a spec that stops answering is a *value* both sides can be
                // compared on rather than a run that never ends. The first version of this had
                // none and took a ten-minute timeout to say what "timeout" says in one second.
                // Reffed for the same reason as `fs`'s: an unreffed deadline lets the loop
                // drain with the promise unsettled, which is the failure it exists to prevent.
                const deadline = setTimeout(() => {
                  socket.destroy();
                  resolve("timeout");
                }, 2000);
                const settle = (value) => { clearTimeout(deadline); resolve(value); };
                const socket = m.connect({ host: "127.0.0.1", port }, () => {
                  socket.end(payload);
                });
                const chunks = [];
                socket.on("data", (chunk) => chunks.push(chunk));
                socket.on("error", (error) => settle(`threw:${error.code ?? error.name}`));
                socket.on("close", () => {
                  const body = Buffer.concat(chunks);
                  // **The address fields are deliberately not compared, and the reason is
                  // worth more than they were.** Reading `remoteAddress`, `remoteFamily` and
                  // `localAddress` in this handler, node answers them in a standalone program
                  // and answers *nothing* here -- same code, same input, different arrangement.
                  // Its post-destroy reporting depends on when the handler runs relative to
                  // internal cleanup, not on the input.
                  //
                  // A field that is not a function of the input cannot be compared against
                  // another implementation: it would report a divergence about scheduling and
                  // call it a behaviour. (`localAddress` specifically does differ -- node
                  // returns `undefined` once the handle is gone and this profile keeps the
                  // cached value -- and that belongs in a fixture that controls the timing,
                  // not in a fuzz over 4,000 inputs.)
                  settle([
                    body.equals(payload) ? "echoed" : `differs:${body.length}/${payload.length}`,
                    socket.bytesWritten,
                    socket.bytesRead,
                    String(socket.destroyed),
                    String(socket.readyState),
                  ].join("~"));
                });
              });
            } catch (error) {
              return `threw:${error.code ?? error.name ?? "?"}`;
            }
          },
        },
      {
        // **`BlockList` whole, and `SocketAddress`.** The corpus already reaches
        // `isIP` and the address parsers; the class that *uses* those answers was
        // 6 of 86 reached, with `addRange`, `addSubnet`, `toJSON`, `fromJSON`,
        // `isBlockList` and `SocketAddress.parse` never called.
        //
        // It belongs in a value-differential and the module's own header says
        // why: `BlockList` is a value-shaped class with no I/O -- addresses in,
        // a boolean out -- and matching an address against a range is exactly
        // where an implementation is almost right. The corpus's inputs are
        // already addresses, valid and malformed, which is the hard half of
        // building this spec and it was already done.
        //
        // Every rule is added under a `try`, because most inputs are not valid
        // addresses and the throw is the comparison: `ERR_INVALID_ADDRESS`
        // against `ERR_INVALID_ARG_TYPE` is a distinction node makes per rule
        // kind.
        label: "blocklist-whole",
        call: (m, s) => {
          const show = (f) => {
            try {
              const v = f();
              return v === undefined ? "undefined" : String(v);
            } catch (error) {
              return `threw:${(error && error.code) || (error && error.name) || "?"}`;
            }
          };
          const list = new m.BlockList();
          const out = [
            show(() => m.BlockList.isBlockList(list)),
            show(() => m.BlockList.isBlockList({})),
            show(() => list.addAddress(s)),
            show(() => list.addAddress(s, "ipv6")),
            show(() => list.addRange(s, "1.2.3.4")),
            show(() => list.addRange("1.2.3.4", s)),
            show(() => list.addSubnet(s, 24)),
            show(() => list.addSubnet("1.2.3.0", 24)),
            show(() => list.check(s)),
            show(() => list.check("1.2.3.4")),
            show(() => list.check("::ffff:1.2.3.4", "ipv6")),
            show(() => list.rules.length),
            show(() => JSON.stringify(list.rules)),
          ];
          // `toJSON`/`fromJSON` round trip, on a list built from inputs node
          // accepted -- a list that rejected everything round-trips trivially.
          const round = new m.BlockList();
          out.push(show(() => {
            round.addSubnet("10.0.0.0", 8);
            round.addRange("192.168.1.1", "192.168.1.9");
            const json = round.toJSON === undefined ? "absent" : JSON.stringify(round.toJSON());
            const back = m.BlockList.fromJSON === undefined
              ? "absent"
              : JSON.stringify(m.BlockList.fromJSON(round.toJSON()).rules);
            return `${json}#${back}`;
          }));
          out.push(show(() => round.check(s)));
          out.push(show(() => round.check("10.1.2.3")));
          out.push(show(() => round.check("192.168.1.5")));
          // `SocketAddress.parse`, which was excluded as absent and is now the
          // reason the exclusion was worth writing down. Node parses through
          // `new URL("http://" + input)`, so a URL's rules show through: a
          // default http port is dropped and `port | 0` turns it into 0, a bare
          // `::1` is not a valid host where `[::1]` is, and a path is ignored.
          // A hand-written parser in this profile got all four of those wrong.
          out.push(show(() => {
            const a = m.SocketAddress.parse(s);
            return a === undefined || a === null ? String(a) : `${a.address}:${a.port}:${a.family}`;
          }));
          // The forms the corpus's address inputs never take on their own: a
          // bracketed host, a port that is http's default, a port that is not,
          // and a path after the authority.
          for (const suffix of ["", ":80", ":8080", ":0", "/x"]) {
            out.push(show(() => {
              const a = m.SocketAddress.parse(`${s}${suffix}`);
              return a === undefined || a === null ? String(a) : `${a.address}:${a.port}:${a.family}`;
            }));
            out.push(show(() => {
              const a = m.SocketAddress.parse(`[${s}]${suffix}`);
              return a === undefined || a === null ? String(a) : `${a.address}:${a.port}:${a.family}`;
            }));
          }
          out.push(show(() => {
            const a = new m.SocketAddress({ address: "1.2.3.4", port: 80 });
            return a.toJSON === undefined ? "absent" : JSON.stringify(a.toJSON());
          }));
          return out.join("|");
        },
      },
      // Error paths. See `REJECTED` above.
      // A string `fd`, which node rejects by type. Not `rejectedNonNumeric`: that
      // table holds `undefined`, and `{ fd: undefined }` means *no* fd, so the
      // constructor succeeds and the harness compares two sockets instead. A
      // value that is invalid for this parameter is not the same as one that is
      // invalid generally -- the third time that distinction has cost a spec.
      //
      // This spec found that ours did not validate the descriptor at all and
      // answered `EPERM` from the adopt call.
      { label: "Socket!", throws: true, call: (m, s) => new m.Socket({ fd: `x${String(s).length}` }) },
      { name: "isIP", args: (s) => [s] },
      { name: "isIPv4", args: (s) => [s] },
      { name: "isIPv6", args: (s) => [s] },
      {
        // `BlockList` is value-shaped: rules go in, a boolean comes out, and
        // the interesting part is which address family a rule applies to.
        label: "blocklist",
        call: (m, s) => {
          let bl;
          try {
            bl = new m.BlockList();
          } catch (e) {
            return `NO-BLOCKLIST:${e && e.name}`;
          }
          const out = [];
          for (const family of ["ipv4", "ipv6"]) {
            try {
              bl.addAddress(s, family);
              out.push(`add-${family}:ok`);
            } catch (e) {
              out.push(`add-${family}:${(e && e.code) || (e && e.name)}`);
            }
            try {
              out.push(`chk-${family}:${bl.check(s, family)}`);
            } catch (e) {
              out.push(`chk-${family}:${(e && e.code) || (e && e.name)}`);
            }
          }
          return out;
        },
      },

        // **The rest of `net`**, which was 40 of 86 published functions.
        //
        // The header above excludes `connect`, `createServer` and `Socket` because
        // "they answer over time to a peer". That is true of connecting and of
        // delivering bytes, and it is not true of the 44 names below: a `Socket`
        // that has never connected answers about **its own state**, synchronously,
        // and `setNoDelay`, `address()`, `ref` and the rest are exactly the calls a
        // program makes before and after a connection rather than during one.
        //
        // `net.Stream === net.Socket`, which is why one spec closes both listings:
        // `corpus-reach.mjs` counts `Socket#setTimeout` and `Stream#setTimeout` as
        // two published names and they are one function object.
        //
        // Nothing here listens, connects or binds, so nothing holds the loop:
        // `process._getActiveHandles()` is empty after a run. That is the property
        // that makes this safe, and it is a property of *not calling* `listen` or
        // `connect` rather than of cleaning up afterwards.
        {
          // The module's pure helpers.
          //
          // `_normalizeArgs` is the argument parser every `connect` and `listen`
          // overload goes through -- a port, a path, a host, an options object, a
          // callback, in almost any arrangement -- and it answers an array with no
          // I/O. It is the single most reused piece of logic in the module and
          // nothing called it.
          //
          // The two `autoSelectFamily` defaults are **process-wide**, so each is set,
          // read back, and put back. The host runs a preflight the child does not, so
          // a value left behind would be read by a later input on one side only.
          label: "net-pure-helpers",
          call: (m, s) => {
            const out = [];
            const attempt = (label, fn) => {
              try {
                out.push(`${label}:ok:${fn()}`);
              } catch (error) {
                out.push(`${label}:${error.code ?? error.name}`);
              }
            };
            const shapes = [
              [],
              [s],
              [80],
              [80, s],
              [s, 80],
              [{ port: 80, host: s }],
              [{ path: s }],
              [80, s, () => {}],
              [s, () => {}],
              [{ port: 80 }, () => {}],
              [null],
              [undefined, () => {}],
            ];
            for (let i = 0; i < shapes.length; i++) {
              const args = shapes[(s.length + i) % shapes.length];
              attempt(`_normalizeArgs(${args.length})`, () => {
                const got = m._normalizeArgs(args);
                // The callback is a function, which does not stringify usefully, so
                // its presence is recorded rather than its identity.
                return JSON.stringify(got.map((part) =>
                  typeof part === "function" ? "fn" : part));
              });
            }

            const wasFamily = m.getDefaultAutoSelectFamily();
            const wasTimeout = m.getDefaultAutoSelectFamilyAttemptTimeout();
            try {
              attempt("setDefaultAutoSelectFamily", () =>
                m.setDefaultAutoSelectFamily(s.length % 2 === 0) ?? "void");
              out.push(`familyRead:${m.getDefaultAutoSelectFamily()}`);
              attempt("setDefaultAutoSelectFamilyAttemptTimeout", () =>
                m.setDefaultAutoSelectFamilyAttemptTimeout(1 + (s.length % 9)) ?? "void");
              out.push(`timeoutRead:${m.getDefaultAutoSelectFamilyAttemptTimeout()}`);
              for (const bad of [null, "x", {}, -1, 0, 1.5, NaN]) {
                attempt(`familyBad:${String(bad)}`, () => m.setDefaultAutoSelectFamily(bad) ?? "void");
                attempt(`timeoutBad:${String(bad)}`, () =>
                  m.setDefaultAutoSelectFamilyAttemptTimeout(bad) ?? "void");
              }
            } finally {
              m.setDefaultAutoSelectFamily(wasFamily);
              m.setDefaultAutoSelectFamilyAttemptTimeout(wasTimeout);
            }
            out.push(`restored:${m.getDefaultAutoSelectFamily() === wasFamily}` +
              `|${m.getDefaultAutoSelectFamilyAttemptTimeout() === wasTimeout}`);

            // `fromJSON` rebuilds a list from what `toJSON` produced, so the round trip
            // is the comparison: a list that serialises and does not deserialise is only
            // visible if both halves run.
            //
            // **On the instance, not the class.** `BlockList.fromJSON` is `undefined` --
            // it is `BlockList.prototype.fromJSON` -- so the first version of this arm
            // called `undefined` on both sides, caught the same `TypeError` on both, and
            // *agreed*. `corpus-reach.mjs` is what said otherwise: the name stayed in the
            // never-called list while the row read as a match, which is the only signal a
            // hollow agreement gives.
            attempt("fromJSON", () => {
              const list = new m.BlockList();
              list.addAddress("1.2.3.4");
              list.addRange("10.0.0.1", `10.0.0.${1 + (s.length % 9)}`);
              list.addSubnet("192.168.0.0", 24);
              const json = list.toJSON();
              const back = new m.BlockList();
              const answer = back.fromJSON(json);
              // The order is deliberately part of the comparison: node's `toJSON` after a
              // `fromJSON` does not reproduce the order it was given, and that is a fact
              // about the rebuild rather than about the input.
              return `returns:${String(answer)}|from:${JSON.stringify(json)}` +
                `|to:${JSON.stringify(back.toJSON())}` +
                `|checks:${back.check("1.2.3.4")}${back.check("192.168.0.9")}${back.check("8.8.8.8")}`;
            });
            // A string is JSON-parsed rather than rejected, an empty array is accepted,
            // and an array of nonsense is accepted and yields nothing -- three answers
            // that no type check would predict.
            for (const bad of [null, undefined, 1, "x", "[]", "{}", {}, [], ["nonsense"],
              [`Address: IPv4 1.2.3.${s.length % 9}`]]) {
              attempt(`fromJSONBad:${JSON.stringify(bad) ?? String(bad)}`, () => {
                const victim = new m.BlockList();
                victim.fromJSON(bad);
                return JSON.stringify(victim.toJSON());
              });
            }

            // `BoundSocket`, which **binds a real socket**, so every one is closed in a
            // `finally`. Measured: 200 of them peak at +201 descriptors and `close()`
            // returns every one, so closing as they are made keeps the peak at one.
            //
            // The port and the descriptor number are *not* compared -- a bound port is
            // whatever the kernel had free and an fd is whatever the process had free,
            // and neither is a function of the input. What is compared is the shape, the
            // family, and the errors a closed one answers.
            // Throttled to one input in twenty. A closed `BoundSocket` returns its
            // descriptor but stays in `process._getActiveHandles()` as an object, so a
            // call on every input would leave twelve thousand of them and about 87MB --
            // the same accounting as `_createServerHandle` above, and the same conclusion:
            // harmless and pointless. Two hundred calls reach the three methods.
            for (const options of (s.length % 20 === 0
              ? [undefined, {}, { port: 0 }, null, 1, "x", []]
              : [])) {
              let bound;
              try {
                bound = new m.BoundSocket(options);
                const address = bound.address();
                attempt(`BoundSocket(${JSON.stringify(options) ?? String(options)})`, () =>
                  `addr:${typeof address === "object" && address !== null ? `${address.address}|${address.family}|${typeof address.port}` : String(address)}` +
                  `|fd:${typeof bound.fd()}`);
                attempt("isPipe", () => String(bound.isPipe()));
              } catch (error) {
                out.push(`BoundSocket(${JSON.stringify(options) ?? String(options)}):${error.code ?? error.name}`);
              } finally {
                if (bound !== undefined) {
                  try { bound.close(); } catch { /* recorded below */ }
                }
              }
              if (bound !== undefined) {
                attempt("afterClose:address", () => JSON.stringify(bound.address()));
                attempt("afterClose:close", () => String(bound.close()));
              }
            }
            return out.join("\n");
          },
        },
        {
          // A `Socket` that has never connected, which is 22 published names on
          // `Socket` and the same 22 on `Stream`.
          //
          // Every call here is about the socket's own state. `address()` on one with
          // no handle is `{}`; `setNoDelay` and `setKeepAlive` answer the socket so
          // they chain; `_getpeername` and `_getsockname` answer an empty object
          // rather than throwing; `ref` and `unref` are no-ops with no handle to
          // touch. Those are the answers a program gets when it configures a socket
          // before connecting, which is the ordinary order to do it in.
          //
          // `setTimeout` is set and then **cleared with 0**, because a timeout left
          // on a socket is a timer, and `_onTimeout` is called directly with a
          // `timeout` listener attached -- without one node's default behaviour on
          // that event is to destroy the socket, which would make every later line
          // answer about a destroyed socket instead.
          label: "net-unconnected-socket",
          call: (m, s) => {
            const out = [];
            const attempt = (label, fn) => {
              try {
                const got = fn();
                out.push(`${label}:ok:${got === undefined ? "void" : typeof got === "object" && got !== null ? JSON.stringify(got) : String(got)}`);
              } catch (error) {
                out.push(`${label}:${error.code ?? error.name}`);
              }
            };
            const socket = new m.Socket();
            const events = [];
            socket.on("error", (error) => events.push(`error:${error.code ?? error.name}`));
            socket.on("timeout", () => events.push("timeout"));

            out.push(`identity:Stream===Socket:${m.Stream === m.Socket}`);
            attempt("address", () => socket.address());
            attempt("_getpeername", () => socket._getpeername());
            attempt("_getsockname", () => socket._getsockname());
            attempt("setNoDelay", () => socket.setNoDelay(s.length % 2 === 0) === socket);
            attempt("setKeepAlive", () =>
              socket.setKeepAlive(s.length % 2 === 0, s.length % 5) === socket);
            attempt("getTypeOfService", () => socket.getTypeOfService());
            attempt("setTypeOfService", () => socket.setTypeOfService(s.length % 8) === socket);
            for (const bad of [null, "x", {}, -1, 256, 1.5]) {
              attempt(`setTypeOfServiceBad:${String(bad)}`, () => socket.setTypeOfService(bad) === socket);
            }
            attempt("pause", () => socket.pause() === socket);
            attempt("resume", () => socket.resume() === socket);
            attempt("ref", () => socket.ref() === socket);
            attempt("unref", () => socket.unref() === socket);
            attempt("setTimeout", () => socket.setTimeout(1000 + s.length) === socket);
            out.push(`timeoutStored:${socket.timeout}`);
            attempt("_onTimeout", () => socket._onTimeout() ?? "void");
            attempt("setTimeoutClear", () => socket.setTimeout(0) === socket);
            out.push(`timeoutCleared:${socket.timeout}`);
            attempt("_writev", () => socket._writev(
              [{ chunk: Buffer.from(s.slice(0, 4)), encoding: "buffer" }], () => {}) ?? "void");
            out.push(`state:pending:${socket.pending}|connecting:${socket.connecting}` +
              `|readyState:${socket.readyState}|destroyed:${socket.destroyed}`);

            // The three ways to end a socket, each on its own instance so the first
            // does not decide what the others see.
            for (const [name, run] of [
              ["destroySoon", (sock) => sock.destroySoon()],
              ["resetAndDestroy", (sock) => sock.resetAndDestroy()],
              ["_reset", (sock) => sock._reset()],
            ]) {
              const victim = new m.Socket();
              const seen = [];
              victim.on("error", (error) => seen.push(error.code ?? error.name));
              attempt(name, () => run(victim) === undefined ? "void" : "returned");
              out.push(`${name}:destroyed:${victim.destroyed}|events:${seen.join(",") || "none"}`);
              victim.destroy();
            }

            socket.destroy();
            out.push(`afterDestroy:${socket.destroyed}|events:${events.join(",") || "none"}`);
            return out.join("\n");
          },
        },
        {
          // A `Server` that has never listened, and `_createServerHandle`.
          //
          // `close` on one answers `ERR_SERVER_NOT_RUNNING` through its callback
          // rather than throwing, which is the distinction a caller that always
          // closes depends on. `getConnections` answers 0 asynchronously.
          //
          // `_createServerHandle` is given an address that **cannot** bind, so it
          // reports an error instead of producing a handle. If it ever does produce
          // one, the handle is closed on the spot -- an open handle holds the loop
          // and the probe's child would never exit.
          label: "net-unlistened-server",
          call: async (m, s) => {
            const out = [];
            const attempt = (label, fn) => {
              try {
                const got = fn();
                out.push(`${label}:ok:${got === undefined ? "void" : typeof got === "object" && got !== null ? JSON.stringify(got) : String(got)}`);
              } catch (error) {
                out.push(`${label}:${error.code ?? error.name}`);
              }
            };
            const server = new m.Server();
            server.on("error", () => {});
            attempt("address", () => server.address());
            attempt("ref", () => server.ref() === server);
            attempt("unref", () => server.unref() === server);
            attempt("setTimeout", () => server.setTimeout(1000 + s.length) === server);
            attempt("maxConnections", () => {
              server.maxConnections = 1 + (s.length % 4);
              return server.maxConnections;
            });
            out.push(`getConnections:${await new Promise((resolve) => {
              try {
                server.getConnections((error, count) =>
                  resolve(error ? `cb:${error.code ?? error.name}` : `ok:${count}`));
              } catch (error) {
                resolve(`threw:${error.code ?? error.name}`);
              }
            })}`);
            out.push(`close:${await new Promise((resolve) => {
              try {
                server.close((error) => resolve(error ? `cb:${error.code ?? error.name}` : "ok"));
              } catch (error) {
                resolve(`threw:${error.code ?? error.name}`);
              }
            })}`);
            attempt("_setupWorker", () => server._setupWorker({
              addHandle() {}, removeHandle() {},
            }) ?? "void");
            for (const bad of [null, undefined, 1, "x"]) {
              attempt(`_setupWorkerBad:${String(bad)}`, () => server._setupWorker(bad) ?? "void");
            }

            // **`_createServerHandle` is not called, and the absence it names is
            // structural rather than a gap.**
            //
            // It hands back a raw libuv `TCP` or `Pipe` handle by address, and node
            // needs that because its `cluster` creates the handle in the primary and
            // passes the object itself to a worker. This profile's cluster distributes
            // differently -- the primary listens and hands the *connection* over, which
            // is what `runtime/node/cluster/test/listen-fd-*.js` pins -- so there is no
            // caller here for a detached server handle and nothing sensible to return.
            //
            // Two things measured along the way, because the first draft called it and
            // the reasoning about why was wrong twice. It leaks: the handle is created
            // *before* the bind is tried and the error code is returned instead, so
            // there is nothing to close, and a guard on
            // `typeof got.close === "function"` closes nothing because what it is
            // handed is a number. But the leak is cheaper than it looks -- 12,000 calls
            // leave 12,000 entries in `process._getActiveHandles()` and cost **one**
            // file descriptor, 87MB of RSS, and no delay to exit. A draft of this
            // comment claimed twelve thousand descriptors, which is what the handle
            // count looks like it implies; `/proc/self/fd` says otherwise because the
            // bind fails before a socket is opened.
            return out.join("\n");
          },
        },
    ];
    })(),
  },
  stream: {
    // The **synchronous** half of a stream, which is more than it sounds and is
    // the half a value-compare corpus can hold.
    //
    // `write()` answers a boolean saying whether the buffer is under the high
    // water mark, `read()` in paused mode answers synchronously from the
    // buffer, and `readableLength`/`writableLength` are exact byte counts. All
    // three are observable without waiting for anything, and all three are what
    // backpressure *is* -- a reimplementation that gets the bytes right and the
    // booleans wrong looks correct until something upstream honours the return
    // value.
    //
    // Excluded and named: `'data'`, `'end'`, `'drain'`, `'finish'` and every
    // other event, plus `pipe`. Those answer over time and comparing them means
    // comparing ordering, which is `fuzz-timer-order.mjs`'s question and not a
    // value compare's. The asynchronous half of `stream` is uncompared here.
    //
    // A small `highWaterMark` is used deliberately so the writes cross it: at
    // the default of 16384 every `write` in a short program answers `true` and
    // the boolean under test never changes.
    fixed: [
      "w1", "w9", "w1w1", "w9w9", "w9w9w9", "wE", "r", "wr", "w9r", "w1r1",
      "wLr", "rw1", "wEw1", "w1E", "Erw", "", "rr", "w1rr", "w9rL", "LL",
      "w1Lw9", "w9Lr", "ww", "w1w9r", "rE", "Ew1", "w9rrL", "Lr", "w1r9", "w9w1L",
    ],
    input: (rnd) => {
      const OPS = ["w1", "w9", "wL", "r", "r1", "r9", "L", "E"];
      let out = "";
      const k = 1 + Math.floor(rnd() * 7);
      for (let i = 0; i < k; i++) out += OPS[Math.floor(rnd() * OPS.length)];
      return out;
    },
    calls: [
      {
        // **The deterministic part of the asynchronous half.** The note above excludes events
        // and `pipe` because comparing them means comparing *ordering*, which belongs to
        // `fuzz-timer-order.mjs`. That still holds. What it ruled out along with them, and did
        // not have to, is the part of the async surface whose answer is a **value**: given a
        // synchronous source, `toArray` and its siblings produce the same array every time.
        //
        // Unreachable until `differential-ts.mjs` and its probe learned to await; `stream` sat
        // at 25 of 108 published functions called, and the iterator helpers were most of the
        // rest. No timers, no sockets, no events compared -- only what the pipeline returns.
        label: "async-iterator-helpers",
        call: async (m, s) => {
          const items = Array.from(s).map((c) => c.charCodeAt(0));
          const from = () => m.Readable.from(items);
          const show = async (make) => {
            try {
              const v = await make();
              return `ok:${Array.isArray(v) ? v.join(",") : String(v)}`;
            } catch (error) {
              return `${error.code ?? error.name ?? "?"}`;
            }
          };
          return [
            await show(() => from().toArray()),
            await show(() => from().map((v) => v * 2).toArray()),
            await show(() => from().filter((v) => v % 2 === 0).toArray()),
            await show(() => from().take(2).toArray()),
            await show(() => from().drop(2).toArray()),
            await show(() => from().flatMap((v) => [v, v]).toArray()),
            await show(() => from().reduce((a, b) => a + b, 0)),
            await show(() => from().every((v) => v > 0)),
            await show(() => from().some((v) => v > 100)),
            await show(() => from().find((v) => v > 100)),
            await show(async () => { let seen = 0; await from().forEach(() => { seen += 1; }); return seen; }),
            await show(async () => { const out = []; for await (const v of from().iterator()) out.push(v); return out; }),
          ].join("|");
        },
      },
      {
        // `pipeline` and `finished` in their promise forms, plus the module-level helpers that
        // answer synchronously. A pipeline over a fixed array settles to one value, so this is a
        // value compare and not an ordering one.
        label: "pipeline-and-helpers",
        call: async (m, s) => {
          const items = Array.from(s).map((c) => c.charCodeAt(0));
          const show = async (make) => {
            try { return `ok:${String(await make())}`; } catch (error) { return `${error.code ?? error.name ?? "?"}`; }
          };
          return [
            await show(async () => {
              if (m.promises?.pipeline === undefined) return "absent";
              const out = [];
              await m.promises.pipeline(
                m.Readable.from(items),
                async function* (source) { for await (const v of source) yield `${v};`; },
                async function (source) { for await (const v of source) out.push(v); },
              );
              return out.join("");
            }),
            await show(async () => {
              if (m.promises?.finished === undefined) return "absent";
              const readable = m.Readable.from(items);
              readable.resume();
              await m.promises.finished(readable);
              return "finished";
            }),
            await show(async () => (m.compose === undefined ? "absent" : typeof m.compose)),
            await show(async () => (m.duplexPair === undefined ? "absent" : m.duplexPair().length)),
            await show(async () => (m.getDefaultHighWaterMark === undefined ? "absent" : m.getDefaultHighWaterMark(false))),
            await show(async () => (m._isUint8Array === undefined ? "absent" : m._isUint8Array(new Uint8Array(1)))),
            await show(async () => (m._isArrayBufferView === undefined ? "absent" : m._isArrayBufferView(new DataView(new ArrayBuffer(2))))),
            await show(async () => (m._uint8ArrayToBuffer === undefined ? "absent" : m._uint8ArrayToBuffer(new Uint8Array([1, 2])).length)),
          ].join("|");
        },
      },

      // Error paths. See `REJECTED` above.
      { label: "pipeline!", throws: true, call: (m, s) => m.pipeline(rejected(s)) },
      {
        // The five pure predicates, which were uncompared -- the corpus reached
        // 2 of `stream`'s 22 functions. Each takes a value and answers a
        // boolean with no I/O, and each is asked about a stream in a *known
        // state* rather than a fresh one: destroyed, ended, errored, written
        // to. A predicate that answers correctly for a new stream and wrongly
        // for a used one is the failure worth catching, and only a state
        // machine reaches it.
        label: "stream-predicates",
        call: (m, program) => {
          const out = [];
          const mk = () => {
            const r = new m.Readable({ read() {} });
            r.on("error", () => {});
            return r;
          };
          const ask = (tag, obj) => {
            for (const n of ["isDestroyed", "isDisturbed", "isErrored", "isReadable", "isWritable"]) {
              try {
                out.push(`${tag}.${n}:${m[n](obj)}`);
              } catch (e) {
                out.push(`${tag}.${n}:threw:${(e && e.code) || (e && e.name)}`);
              }
            }
          };
          ask("fresh", mk());
          const destroyed = mk();
          destroyed.destroy();
          ask("destroyed", destroyed);
          const errored = mk();
          errored.destroy(new Error("x"));
          ask("errored", errored);
          const pushed = mk();
          pushed.push(Buffer.from(program.slice(0, 4) || "a"));
          pushed.read();
          ask("read", pushed);
          const w = new m.Writable({ write(_c, _e, cb) { cb(); } });
          w.on("error", () => {});
          ask("writable", w);
          w.end();
          ask("ended", w);
          // Non-stream values: node answers these rather than throwing, and a
          // reimplementation that throws instead is a difference no pinned test
          // reaches.
          ask("plain", {});
          ask("nul", null);
          return out;
        },
      },
      {
        label: "stream-program",
        call: (m, program) => {
          const log = [];
          const chunkFor = (c) => {
            if (c === "1") return Buffer.alloc(1, 0x61);
            if (c === "9") return Buffer.alloc(9, 0x62);
            return Buffer.alloc(4, 0x63);
          };
          let readable, writable;
          try {
            readable = new m.Readable({ highWaterMark: 8, read() {} });
            // The callback is **held, not called**. Calling it synchronously
            // drains the buffer on every write, so `writableLength` never grows
            // and `write()` answers `true` forever -- the first version did
            // exactly that and only 1 of 30 fixed inputs ever saw a `false`,
            // which made the corpus nearly vacuous about the one thing it
            // exists to compare. Holding the callbacks keeps the buffer full
            // and makes backpressure observable synchronously.
            const held = [];
            writable = new m.Writable({
              highWaterMark: 8,
              write(_c, _e, cb) {
                held.push(cb);
              },
            });
            // Required, not defensive. A write after `end()` emits `'error'`
            // asynchronously with `ERR_STREAM_WRITE_AFTER_END`, and an
            // unhandled `'error'` on a stream takes the whole process down --
            // the first run of this corpus died that way mid-sweep. The
            // handlers swallow it because the event is asynchronous and this
            // corpus compares synchronous answers only; the error is therefore
            // **uncompared**, while the synchronous `write()` return value
            // beside it is compared.
            writable.on("error", () => {});
            readable.on("error", () => {});
          } catch (e) {
            return `CONSTRUCT-FAILED:${e && e.name}`;
          }
          let i = 0;
          let step = 0;
          while (i < program.length) {
            const op = program[i];
            const arg = program[i + 1];
            step++;
            try {
              if (op === "w") {
                if (arg === "E") {
                  writable.end();
                  log.push(`end${step}`);
                  i += 2;
                } else {
                  log.push(`w${step}:${writable.write(chunkFor(arg))}`);
                  i += 2;
                }
              } else if (op === "r") {
                const digit = arg >= "0" && arg <= "9" ? Number(arg) : undefined;
                const got = readable.read(digit);
                log.push(`r${step}:${got === null ? "null" : got.length}`);
                i += digit === undefined ? 1 : 2;
              } else if (op === "L") {
                log.push(`L${step}:${readable.readableLength},${writable.writableLength}`);
                i += 1;
              } else if (op === "E") {
                readable.push(chunkFor("9"));
                log.push(`push${step}:${readable.readableLength}`);
                i += 1;
              } else {
                i += 1;
              }
            } catch (e) {
              log.push(`THREW${step}:${e && e.name}:${(e && e.code) || ""}`);
              i += 1;
            }
          }
          return log;
        },
      },

      // **The rest of `stream`**, which was 56 of 108 published functions.
      //
      // The section header above excludes events and `pipe` because comparing
      // them means comparing ordering, and that is `fuzz-timer-order.mjs`'s
      // question. That rule is kept, and it is narrower than it was read to be:
      // what it rules out is *when* a stream does something, not *what* it
      // answers. `setEncoding`, `unshift`, `cork`, `isPaused`, `readableLength`
      // and the rest below all answer synchronously from state the input sets.
      //
      // Everything asynchronous here is awaited to completion over a source that
      // ends, and there are no timers. A stream that never ends would leave the
      // probe's child holding a pending promise and the parent's `spawnSync`
      // waiting on it, so every source is a finite array or an explicit
      // `push(null)`.
      {
        // The readable side's mode machinery: encoding, push-back, and the
        // paused/flowing distinction.
        //
        // `setEncoding` has the real trap. It changes what `read()` answers from
        // a `Buffer` to a string, and it must apply to bytes **already
        // buffered** as well as to later ones -- node re-decodes what is held --
        // so the input decides whether the call lands before or after the pushes.
        label: "readable-modes",
        call: (m, s) => {
          const seed = s.length;
          const out = [];
          const chunks = ["a", "bb", "ü", "日"].slice(0, 1 + (seed % 4));
          const readable = new m.Readable({ read() {}, highWaterMark: 4 });

          const encodeFirst = seed % 2 === 0;
          if (encodeFirst) readable.setEncoding("utf8");
          for (const chunk of chunks) out.push(`push:${readable.push(chunk)}`);
          if (!encodeFirst) readable.setEncoding("utf8");
          out.push(`len:${readable.readableLength}|enc:${readable.readableEncoding}`);

          // `unshift` puts data back at the front, so the next `read` sees it
          // ahead of anything pushed earlier.
          out.push(`unshift:${readable.unshift("<")}`);
          out.push(`afterUnshift:${readable.readableLength}`);
          out.push(`read:${JSON.stringify(readable.read())}`);

          // Paused and flowing. `isPaused` is not the negation of `pause()`: a
          // stream that has never flowed is not paused either, and node reports
          // `readableFlowing` as null for it.
          out.push(`paused0:${readable.isPaused()}|flowing0:${readable.readableFlowing}`);
          readable.pause();
          out.push(`paused1:${readable.isPaused()}|flowing1:${readable.readableFlowing}`);
          readable.resume();
          out.push(`paused2:${readable.isPaused()}|flowing2:${readable.readableFlowing}`);
          readable.pause();
          out.push(`paused3:${readable.isPaused()}`);

          // `_undestroy` puts a destroyed stream back into a usable state, which
          // is what socket reuse is built on.
          readable.destroy();
          out.push(`destroyed:${readable.destroyed}|errored:${readable.errored}`);
          readable._undestroy();
          out.push(`undestroyed:${readable.destroyed}|readable:${readable.readable}`);

          // The base `_read` is left unimplemented on purpose, and calling it is
          // how a subclass that forgot to override it fails.
          try {
            m.Readable.prototype._read.call(readable, 16);
            out.push("_read:accepted");
          } catch (error) {
            out.push(`_read:${error.code || error.name}`);
          }
          return out.join("\n");
        },
      },
      {
        // The writable side: corking, the default encoding, and the byte counts
        // that make backpressure observable.
        //
        // `cork` is the interesting one. It buffers writes rather than passing
        // them down, `writableCorked` counts the nesting, and only the matching
        // number of `uncork`s releases them -- so a mismatched pair is a stream
        // that silently stops delivering. The input sets the nesting depth, and
        // one `uncork` short of it is asserted to release nothing.
        label: "writable-cork",
        call: (m, s) => {
          const seed = s.length;
          const written = [];
          const writable = new m.Writable({
            highWaterMark: 4,
            write(chunk, encoding, cb) {
              written.push(`${encoding}:${Buffer.from(chunk).toString("hex")}`);
              cb();
            },
          });
          const out = [];
          const depth = 1 + (seed % 3);
          for (let i = 0; i < depth; i++) writable.cork();
          out.push(`corked:${writable.writableCorked}`);

          // `setDefaultEncoding` changes how a *string* write is interpreted, so
          // the bytes recorded above differ although the call does not.
          const ENCODINGS = ["utf8", "latin1", "hex", "base64", "utf16le", "ascii"];
          const encoding = ENCODINGS[seed % ENCODINGS.length];
          try {
            out.push(`setDefault:${writable.setDefaultEncoding(encoding) === writable}`);
          } catch (error) {
            out.push(`setDefault:${error.code || error.name}`);
          }
          out.push(`write:${writable.write("4142")}`);
          out.push(`lenCorked:${writable.writableLength}|written:${written.length}`);

          for (let i = 0; i < depth - 1; i++) writable.uncork();
          out.push(`partial:${writable.writableCorked}|written:${written.length}`);
          writable.uncork();
          out.push(`released:${writable.writableCorked}|written:${JSON.stringify(written)}`);
          out.push(`hwm:${writable.writableHighWaterMark}|need:${writable.writableNeedDrain}`);

          try {
            writable.setDefaultEncoding(`not-${encoding}`);
            out.push("badEncoding:accepted");
          } catch (error) {
            out.push(`badEncoding:${error.code || error.name}`);
          }
          try {
            m.Writable.prototype._write.call(writable, Buffer.from("x"), "buffer", () => {});
            out.push("_write:accepted");
          } catch (error) {
            out.push(`_write:${error.code || error.name}`);
          }

          writable.destroy();
          out.push(`destroyed:${writable.destroyed}`);
          writable._undestroy();
          out.push(`undestroyed:${writable.destroyed}|writable:${writable.writable}`);
          return out.join("\n");
        },
      },
      {
        // `pipe`/`unpipe` through what they change **synchronously**, which is
        // not an ordering question.
        //
        // `pipe` answers the destination -- that is what makes it chainable --
        // and flips the source out of paused mode on the spot. `unpipe` undoes
        // it. Neither fact is about when a chunk arrives, so both are in scope
        // here while the delivery they set up is not.
        label: "pipe-unpipe",
        call: async (m, s) => {
          const seed = s.length;
          const out = [];
          const source = new m.Readable({ read() {} });
          source.push("x");
          const sink = new m.Writable({ write(_c, _e, cb) { cb(); } });

          out.push(`before:${source.readableFlowing}|listeners:${source.listenerCount("data")}`);
          out.push(`pipeReturns:${source.pipe(sink) === sink}`);
          out.push(`after:${source.readableFlowing}|listeners:${source.listenerCount("data")}`);
          out.push(`names:${source.eventNames().map(String).sort().join(",")}`);

          if (seed % 2 === 0) {
            source.unpipe(sink);
            out.push(`unpipeOne:${source.readableFlowing}`);
          } else {
            source.unpipe();
            out.push(`unpipeAll:${source.readableFlowing}`);
          }
          out.push(`afterUnpipe:${source.listenerCount("data")}`);

          // `removeAllListeners` with and without a name, which differ.
          source.on("close", () => {});
          source.on("error", () => {});
          out.push(`namesBefore:${source.eventNames().map(String).sort().join(",")}`);
          source.removeAllListeners(seed % 3 === 0 ? "close" : undefined);
          out.push(`namesAfter:${source.eventNames().map(String).sort().join(",")}`);

          // A `Writable` inherits `pipe` and it is meaningless on one, since
          // there is nothing to read. It answers the destination **and then
          // fails**: node emits `ERR_STREAM_CANNOT_PIPE` on the source a tick
          // later, so the return value and the error are both part of the
          // contract and the error is the half that is easy to miss.
          //
          // The listener is not optional. Without it the emit is an uncaught
          // exception, and because it lands a tick later it killed the probe
          // *during a different spec* -- `pipe-unpipe` reported a clean result
          // and the process died inside `stream-lifecycle`, which is what a
          // deferred throw looks like from the outside.
          const w = new m.Writable({ write(_c, _e, cb) { cb(); } });
          const pipeErrors = [];
          w.on("error", (error) => pipeErrors.push(error.code || error.name));
          out.push(`writablePipe:${w.pipe(sink) === sink}`);
          await new Promise((resolve) => queueMicrotask(resolve));
          await new Promise((resolve) => setImmediate(resolve));
          out.push(`writablePipeError:${pipeErrors.join(",") || "none"}`);
          w.destroy();
          source.destroy();
          sink.destroy();
          return out.join("\n");
        },
      },
      {
        // `Stream`'s own surface: the constructors it republishes and the
        // functions hanging off it.
        //
        // `stream.Readable` and `stream.Stream.Readable` are the same class, and
        // a corpus that only reaches for the first never calls the second.
        // Constructing through each is what would tell them apart if they ever
        // stopped being one object.
        label: "stream-statics",
        call: (m, s) => {
          const seed = s.length;
          const out = [];
          const Stream = m.Stream;
          out.push(`selfRef:${Stream.Stream === Stream}`);
          for (const name of ["Readable", "Writable", "Duplex", "Transform", "PassThrough"]) {
            out.push(`same:${name}:${Stream[name] === m[name]}`);
            try {
              const made = new Stream[name]({
                read() {},
                write(_c, _e, cb) { cb(); },
                transform(c, _e, cb) { cb(null, c); },
              });
              out.push(`new:${name}:${made.constructor.name}|${made instanceof Stream[name]}`);
              made.destroy();
            } catch (error) {
              out.push(`new:${name}:${error.code || error.name}`);
            }
          }
          try {
            const base = new Stream();
            out.push(`base:${typeof base.pipe}|${base instanceof Stream}`);
          } catch (error) {
            out.push(`base:${error.code || error.name}`);
          }

          // The default high water mark is **process-wide state**, so it is set,
          // observed through a stream built while it holds, and put back. The
          // host runs a preflight the child does not, so a value left behind here
          // would be read by a later input on one side only -- which is exactly
          // how `console.count` diverged before it was reset.
          const objectMode = seed % 2 === 0;
          const before = Stream.getDefaultHighWaterMark(objectMode);
          try {
            Stream.setDefaultHighWaterMark(objectMode, 1 + (seed % 7));
            out.push(`hwmGet:${Stream.getDefaultHighWaterMark(objectMode)}`);
            const made = new m.Readable({ objectMode, read() {} });
            out.push(`hwmApplied:${made.readableHighWaterMark}`);
            made.destroy();
          } catch (error) {
            out.push(`hwm:${error.code || error.name}`);
          } finally {
            Stream.setDefaultHighWaterMark(objectMode, before);
          }
          out.push(`hwmRestored:${Stream.getDefaultHighWaterMark(objectMode) === before}`);

          // Its validation, which is where a default that is not a number would
          // otherwise be stored and corrupt every stream built afterwards.
          for (const bad of [-1, "8", null, 1.5, NaN]) {
            try {
              Stream.setDefaultHighWaterMark(objectMode, bad);
              out.push(`hwmBad:${JSON.stringify(bad)}:accepted`);
            } catch (error) {
              out.push(`hwmBad:${JSON.stringify(bad)}:${error.code || error.name}`);
            } finally {
              Stream.setDefaultHighWaterMark(objectMode, before);
            }
          }
          return out.join("\n");
        },
      },
      {
        // `destroy`, `finished` and `addAbortSignal` as free functions.
        //
        // `finished` is awaited over a stream that **has already ended**, so it
        // settles without waiting for anything. The signal handed to
        // `addAbortSignal` is already aborted for the same reason: one that never
        // fires leaves the callback outstanding, and an unreffed timer to bound
        // it cannot settle a promise because it does not hold the loop.
        label: "stream-lifecycle",
        call: async (m, s) => {
          const seed = s.length;
          const out = [];

          const ended = m.Readable.from(["a", "b"]);
          await ended.toArray();
          try {
            await new Promise((resolve, reject) => {
              m.finished(ended, (error) => (error ? reject(error) : resolve()));
            });
            out.push("finished:clean");
          } catch (error) {
            out.push(`finished:${error.code || error.name}`);
          }

          // The same function on a stream destroyed with an error, which is the
          // arm that reports rather than resolves.
          const broken = new m.Readable({ read() {} });
          m.destroy(broken, Object.assign(new Error(`broke${seed % 3}`), { code: "ENTS" }));
          try {
            await new Promise((resolve, reject) => {
              m.finished(broken, (error) => (error ? reject(error) : resolve()));
            });
            out.push("finishedBroken:clean");
          } catch (error) {
            out.push(`finishedBroken:${error.code || error.message}`);
          }
          out.push(`destroyed:${broken.destroyed}|errored:${broken.errored && broken.errored.code}`);

          // `addAbortSignal` with a signal that has already fired: the stream is
          // destroyed with node's abort error.
          const guarded = new m.Readable({ read() {} });
          try {
            out.push(`addAbortSignal:${m.addAbortSignal(AbortSignal.abort(), guarded) === guarded}`);
            await new Promise((resolve) => { m.finished(guarded, () => resolve()); });
            out.push(`aborted:${guarded.destroyed}|${guarded.errored && guarded.errored.name}`);
          } catch (error) {
            out.push(`addAbortSignal:${error.code || error.name}`);
          }

          // **`null` is excluded, and the reason is that node's answer for it is an
          // accident rather than a decision.** Node's local validator reads
          //
          //     if (typeof signal !== 'object' || !('aborted' in signal))
          //
          // and `typeof null === "object"`, so `null` reaches the `in` operator,
          // which throws an engine `TypeError` with no code. Every other rejected
          // value gets `ERR_INVALID_ARG_TYPE`. This profile answers
          // `ERR_INVALID_ARG_TYPE` for `null` too, which is the coded error the
          // same function gives for `{}` and for `"signal"`.
          //
          // Matching node here would mean reproducing a defect to lose
          // information: a caller branching on `error.code` can handle every bad
          // argument except `null`. So it is recorded and not copied, and the
          // recording is this comment plus its absence from the list -- one known
          // decision kept out of the way of the comparisons around it.
          //
          // Labelled with the value and not `typeof`, because `typeof null` and
          // `typeof {}` are both "object" and the two rows were indistinguishable.
          for (const bad of [undefined, {}, "signal", 0, true]) {
            const victim = new m.Readable({ read() {} });
            try {
              m.addAbortSignal(bad, victim);
              out.push(`addAbortSignalBad:${JSON.stringify(bad) ?? "undefined"}:accepted`);
            } catch (error) {
              out.push(`addAbortSignalBad:${JSON.stringify(bad) ?? "undefined"}:${error.code || error.name}`);
            }
            victim.destroy();
          }
          return out.join("\n");
        },
      },
      {
        // `compose` and `Duplex.from`, which build a stream out of parts.
        //
        // Both are compared through `toArray` over a finite source, so the answer
        // is the array and not the timing. `Duplex.from` accepts several shapes
        // -- an iterable, an async generator function, a string, a promise -- and
        // the input picks which, so the branch taken is a function of the input
        // rather than of the spec.
        label: "compose-and-from",
        call: async (m, s) => {
          const seed = s.length + (s.charCodeAt(0) || 0);
          const out = [];
          const items = ["a", "bb", "ccc"].slice(0, 1 + (seed % 3));

          try {
            const composed = m.compose(
              m.Readable.from(items),
              async function* upper(source) {
                for await (const chunk of source) yield String(chunk).toUpperCase();
              },
            );
            out.push(`compose:${JSON.stringify((await composed.toArray()).map(String))}`);
          } catch (error) {
            out.push(`compose:${error.code || error.name}`);
          }

          try {
            const chained = m.Readable.from(items).compose(
              async function* tag(source) {
                for await (const chunk of source) yield `<${chunk}>`;
              },
            );
            out.push(`readableCompose:${JSON.stringify((await chained.toArray()).map(String))}`);
          } catch (error) {
            out.push(`readableCompose:${error.code || error.name}`);
          }

          const SHAPES = ["iterable", "asyncgen", "string", "promise"];
          const shape = SHAPES[seed % SHAPES.length];
          try {
            let built;
            if (shape === "iterable") built = m.Duplex.from(items);
            else if (shape === "asyncgen") built = m.Duplex.from(async function* gen() { yield* items; });
            else if (shape === "string") built = m.Duplex.from(items.join("|"));
            else built = m.Duplex.from(Promise.resolve(items.join("/")));
            out.push(`from:${shape}:${JSON.stringify((await built.toArray()).map(String))}`);
          } catch (error) {
            out.push(`from:${shape}:${error.code || error.name}`);
          }

          for (const bad of [undefined, null, 1, true]) {
            try {
              out.push(`fromBad:${typeof bad}:accepted:${typeof m.Duplex.from(bad)}`);
            } catch (error) {
              out.push(`fromBad:${typeof bad}:${error.code || error.name}`);
            }
          }
          return out.join("\n");
        },
      },
      {
        // The Web Streams bridges, both directions, drained to completion.
        //
        // `toWeb` hands back a `ReadableStream` whose reader must be run to
        // `done`, and `fromWeb` the reverse. Each is awaited fully, so neither
        // leaves a lock held or a promise pending.
        label: "web-bridges",
        call: async (m, s) => {
          const seed = s.length;
          const out = [];
          const items = ["a", "bb", "ccc"].slice(0, 1 + (seed % 3));

          try {
            const web = m.Readable.toWeb(m.Readable.from(items));
            out.push(`toWeb:${web.constructor.name}|locked:${web.locked}`);
            const reader = web.getReader();
            const seen = [];
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              seen.push(String(value));
            }
            reader.releaseLock();
            out.push(`toWebRead:${JSON.stringify(seen)}`);
          } catch (error) {
            out.push(`toWeb:${error.code || error.name}`);
          }

          try {
            const source = new ReadableStream({
              start(controller) {
                for (const item of items) controller.enqueue(item);
                controller.close();
              },
            });
            out.push(`fromWeb:${JSON.stringify((await m.Readable.fromWeb(source).toArray()).map(String))}`);
          } catch (error) {
            out.push(`fromWeb:${error.code || error.name}`);
          }

          try {
            const chunks = [];
            const writable = new m.Writable({
              write(chunk, _e, cb) { chunks.push(Buffer.from(chunk).toString()); cb(); },
            });
            const writer = m.Writable.toWeb(writable).getWriter();
            for (const item of items) await writer.write(Buffer.from(item));
            await writer.close();
            out.push(`writableToWeb:${JSON.stringify(chunks)}`);
          } catch (error) {
            out.push(`writableToWeb:${error.code || error.name}`);
          }

          try {
            const seen = [];
            const web = new WritableStream({ write(chunk) { seen.push(String(chunk)); } });
            const back = m.Writable.fromWeb(web);
            await new Promise((resolve, reject) => {
              back.on("error", reject);
              back.end(items.join(""), () => resolve());
            });
            out.push(`writableFromWeb:${JSON.stringify(seen)}`);
          } catch (error) {
            out.push(`writableFromWeb:${error.code || error.name}`);
          }

          for (const bad of [undefined, null, {}, 1]) {
            try {
              m.Readable.fromWeb(bad);
              out.push(`fromWebBad:${typeof bad}:accepted`);
            } catch (error) {
              out.push(`fromWebBad:${typeof bad}:${error.code || error.name}`);
            }
          }
          return out.join("\n");
        },
      },
      {
        // `Transform`'s hooks and the legacy `wrap`.
        //
        // A `PassThrough` drives `Transform#_write`, `Transform#_read` and
        // `PassThrough#_transform` through the machinery rather than by calling
        // them, which is the only way those three are reached the way a program
        // reaches them. The bare `Transform#_transform` is node's unimplemented
        // stub and is called directly, because nothing that works reaches it.
        label: "transform-and-wrap",
        call: async (m, s) => {
          const seed = s.length;
          const out = [];
          const items = ["a", "bb", "ccc"].slice(0, 1 + (seed % 3));

          const through = new m.PassThrough();
          for (const item of items) through.write(item);
          through.end();
          out.push(`passThrough:${JSON.stringify((await through.toArray()).map(String))}`);

          try {
            const bare = new m.Transform();
            m.Transform.prototype._transform.call(bare, Buffer.from("x"), "buffer", (e) => {
              out.push(`_transformCb:${e ? e.code || e.name : "null"}`);
            });
            bare.destroy();
          } catch (error) {
            out.push(`_transform:${error.code || error.name}`);
          }

          // `wrap` adapts an old-style stream -- one that only emits `data` and
          // `end` -- into a modern readable. The source emits both synchronously
          // after being wrapped, so the result is finite.
          // Hand-rolled rather than `new EventEmitter()`, because the host
          // evaluates these specs inside an ES module where `require` does not
          // exist while the probe's child is CommonJS where it does. A helper
          // that resolves differently on the two sides is a divergence the
          // harness caused, and `wrap`'s contract needs only `on`, `pause` and
          // `resume`.
          const legacy = () => {
            const handlers = new Map();
            return {
              on(name, fn) {
                if (!handlers.has(name)) handlers.set(name, []);
                handlers.get(name).push(fn);
                return this;
              },
              removeListener(name, fn) {
                const list = handlers.get(name);
                if (list) handlers.set(name, list.filter((f) => f !== fn));
                return this;
              },
              emit(name, ...args) {
                for (const fn of handlers.get(name) ?? []) fn(...args);
                return true;
              },
              pause() {},
              resume() {},
            };
          };
          try {
            const source = legacy();
            const wrapped = new m.Readable({ read() {} }).wrap(source);
            for (const item of items) source.emit("data", item);
            source.emit("end");
            out.push(`wrap:${JSON.stringify((await wrapped.toArray()).map(String))}`);
          } catch (error) {
            out.push(`wrap:${error.code || error.name}`);
          }

          try {
            const source = legacy();
            const wrapped = m.Readable.wrap(source);
            source.emit("data", items[0]);
            source.emit("end");
            out.push(`staticWrap:${JSON.stringify((await wrapped.toArray()).map(String))}`);
          } catch (error) {
            out.push(`staticWrap:${error.code || error.name}`);
          }
          return out.join("\n");
        },
      },
    ],
  },
  process: {
    // The value-shaped half of `process`, which is smaller than it looks and
    // is the only half a value-compare corpus can hold.
    //
    // Excluded and named rather than normalised: `hrtime`, `uptime`,
    // `memoryUsage`, `cpuUsage`, `resourceUsage` and `pid` all answer
    // differently every call or every process by design, and `exit`,
    // `abort`, `kill` and `chdir` change the host rather than answer about it.
    // What is left is argument validation and the pure conversions, and that
    // is where a reimplementation actually differs.
    //
    // `uid|` and `umaskread|` were in the `fixed` list with **no branch to
    // handle them**. They fell through to the `cwd()` arm, so two seeds named
    // after one thing silently measured another, and nothing in the file said
    // so. Found by enumerating which branch every generated and fixed input
    // actually takes, after MainClaude hit the same shape from the other side:
    // a fixture dispatching on `n % 10` where no value in the pool was
    // congruent to 4, so one receiver was never built and the run reported
    // "agreed on every case" over 290 of them.
    //
    // `emitWarning` was here through its validation only and has been removed.
    // A valid call *emits*, and 400 iterations put hundreds of warnings on the
    // process's stderr -- side effects a comparison corpus has no business
    // producing. Quieting them was not an option: `NODE_NO_WARNINGS` once hid a
    // difference two pinned tests depend on. The validation slice alone was not
    // worth the noise, and the emitted warning itself is asynchronous and
    // belongs to a timing harness.
    fixed: [
      "hrtime|", "hrtime|0", "hrtime|1,2", "hrtime|N", "hrtime|s",
      "env|PATH", "env|__nts_absent__", "env|", "env|=",
      "cwdrel|.", "cwdrel|..", "cwdrel|x", "cwdrel|",
    ],
    input: (rnd) => {
      const KINDS = ["hrtime", "env", "cwdrel"];
      const ARGS = ["", "0", "1,2", "N", "s", "o", "PATH", ".", "..", "x", "=", "__nts_absent__", "1e21", "-1"];
      return `${KINDS[Math.floor(rnd() * KINDS.length)]}|${ARGS[Math.floor(rnd() * ARGS.length)]}`;
    },
    calls: [
      {
        // **A separate spec rather than another `kind` in `process-op`.** The header above
        // records two seeds -- `uid|` and `umaskread|` -- that were in `fixed` with no branch to
        // handle them and fell through to the `cwd()` arm, so two named cases silently measured
        // a third thing. A `kind` only runs if the generator produces it; a spec runs for every
        // input, and so cannot be added without being exercised.
        //
        // `corpus-reach.mjs` had this module at **2 of 61** published functions. Everything below
        // is either argument validation -- which throws before it touches the host -- or a read
        // whose answer is the same for both processes, because they run as the same user on the
        // same machine. Nothing here mutates: no `exit`, `abort`, `execve`, `chdir` with a usable
        // path, or any of the `set*id` family, and `kill` only ever sees a signal name no
        // platform defines.
        label: "process-validation",
        call: (m, spec) => {
          const arg = spec.includes("|") ? spec.slice(spec.indexOf("|") + 1) : spec;
          const attempt = (make) => {
            try {
              const v = make();
              return `ok:${typeof v === "object" && v !== null ? "object" : String(v)}`;
            } catch (error) {
              return `${error?.code ?? error?.name ?? "?"}`;
            }
          };
          // **`binding` and `getBuiltinModule` are deliberately not here**, and the difference
          // from `stream`'s three missing byte helpers is the point. Those were undocumented
          // absences nobody had acted on, and a comparison is exactly how such a thing gets
          // noticed. These two are *recorded decisions*: `process/test/export-surface-static.js`
          // lists both as absent -- "loader and V8 plumbing with no representation here" -- and
          // `not-applicable` names the blocker, "getBuiltinModule needs the planned runtime
          // builtin-module registry". A spec reporting a decision back 4,000 times a run is
          // noise, and noise in a differential is what teaches people to skim its output.
          const absent = (fn) => typeof fn !== "function";
          return [
            // A pid that is not a number cannot reach a signal.
            attempt(() => (absent(m.kill) ? "absent" : m.kill({ pid: arg }, "SIGTERM"))),
            // A signal name no platform defines, so validation is reached and nothing else is.
            attempt(() => (absent(m.kill) ? "absent" : m.kill(m.pid, `NOTASIG_${arg}`))),
            // `chdir` of a non-string throws before it changes the working directory.
            attempt(() => (absent(m.chdir) ? "absent" : m.chdir({ toString: () => arg }))),
            attempt(() => (absent(m.cpuUsage) ? "absent" : m.cpuUsage(arg))),
            attempt(() => (absent(m.nextTick) ? "absent" : m.nextTick(arg))),
            attempt(() =>
              (absent(m.setUncaughtExceptionCaptureCallback)
                ? "absent"
                : m.setUncaughtExceptionCaptureCallback(arg))),
            attempt(() =>
              (absent(m.hasUncaughtExceptionCaptureCallback)
                ? "absent"
                : m.hasUncaughtExceptionCaptureCallback())),
            // Identity, the same for both processes because they are the same user on the same
            // machine. A difference here would be a real one.
            attempt(() => (absent(m.getuid) ? "absent" : typeof m.getuid())),
            attempt(() => (absent(m.geteuid) ? "absent" : typeof m.geteuid())),
            attempt(() => (absent(m.getgid) ? "absent" : typeof m.getgid())),
            attempt(() => (absent(m.getegid) ? "absent" : typeof m.getegid())),
            attempt(() => (absent(m.getgroups) ? "absent" : Array.isArray(m.getgroups()))),
            // `umask()` with no argument reads; it does not set.
            attempt(() => (absent(m.umask) ? "absent" : typeof m.umask())),
          ].join("|");
        },
      },
      {
        label: "process-op",
        call: (m, spec) => {
          const bar = spec.indexOf("|");
          const kind = spec.slice(0, bar);
          const arg = spec.slice(bar + 1);
          const asValue = (t) => {
            if (t === "") return undefined;
            if (t === "N") return NaN;
            if (t === "s") return "str";
            if (t === "o") return { a: 1 };
            if (t.includes(",")) return t.split(",").map(Number);
            const n = Number(t);
            return Number.isNaN(n) ? t : n;
          };
          try {
            if (kind === "hrtime") {
              // The *shape* and validation, never the elapsed value: a valid
              // call answers a two-element array of finite numbers and that is
              // all this compares.
              const v = m.hrtime(asValue(arg));
              return ["ok", Array.isArray(v), v.length, typeof v[0], typeof v[1]];
            }
            if (kind === "env") {
              const v = m.env[arg];
              return ["ok", typeof v, v === undefined ? "undef" : "present"];
            }
            // `cwd()` is absolute and machine-specific, so only its invariants
            // are compared -- absoluteness and that it has no trailing sep.
            const c = m.cwd();
            return ["ok", c.startsWith("/"), c.length > 1 && c.endsWith("/")];
          } catch (e) {
            return ["THREW", e && e.name, (e && e.code) || ""];
          }
        },
      },

      // **The part of `process`'s remaining surface that a value compare can hold**,
      // which is its argument validation and nothing else.
      //
      // The header above already names what is excluded and why -- `hrtime`,
      // `uptime`, `memoryUsage`, `cpuUsage`, `resourceUsage` and `pid` answer
      // differently every call by design; `exit`, `abort`, `kill` and `chdir`
      // change the host rather than answer about it; `emitWarning` puts hundreds of
      // warnings on stderr over a corpus run. All of that still holds, and
      // `constrainedMemory`, `availableMemory`, `threadCpuUsage`,
      // `getActiveResourcesInfo`, `_getActiveHandles` and `_getActiveRequests`
      // belong to the same first group: each answers about the process it runs in,
      // and the host has a preflight the child does not.
      //
      // Named here because `corpus-reach.mjs` counts them and a reader deserves to
      // know which absences are decisions: `reallyExit`, `_kill`, `execve`,
      // `_fatalException`, `dlopen` with a real path, `openStdin`, `_tickCallback`,
      // `report.writeReport`, and `stdout.write`/`stderr.write` with their
      // `_destroy`/`destroySoon`. The last pair is the sharpest -- the probe returns
      // its results **on stdout**, so a spec that writes there corrupts the channel
      // the comparison travels over, and the failure would read as a divergence.
      //
      // What is left is validation, and it is worth having: these are the errors a
      // caller sees for a wrong argument, and there are eighteen functions here
      // whose validation nothing compared.
      {
        // The credential setters, with **non-numeric and non-string arguments
        // only**.
        //
        // That restriction is the whole safety argument. Node validates the
        // argument's type before it asks the kernel, so an object, an array, `null`
        // and `true` answer `ERR_INVALID_ARG_TYPE` and the process's credentials are
        // untouched. A number or a string could name a real user or group, and
        // succeeding would drop the privileges of every later input in the run.
        //
        // Checked rather than argued: the credentials are read before and after and
        // the comparison includes whether they moved, so if this ever stops being
        // safe the corpus says so instead of quietly running as somebody else.
        label: "process-credentials-refused",
        call: (m, s) => {
          const BAD = [{}, [], null, true, undefined];
          const before = `${m.getuid()}:${m.getgid()}:${m.geteuid()}:${m.getegid()}`;
          const out = [];
          const attempt = (label, fn) => {
            try {
              fn();
              out.push(`${label}:ACCEPTED`);
            } catch (error) {
              out.push(`${label}:${error.code ?? error.name}`);
            }
          };
          const show = (v) =>
            v === null ? "null" : v === undefined ? "undefined" : Array.isArray(v) ? "array" : typeof v;
          for (let i = 0; i < BAD.length; i++) {
            const bad = BAD[(s.length + i) % BAD.length];
            const shown = show(bad);
            attempt(`setuid(${shown})`, () => m.setuid(bad));
            attempt(`setgid(${shown})`, () => m.setgid(bad));
            attempt(`seteuid(${shown})`, () => m.seteuid(bad));
            attempt(`setegid(${shown})`, () => m.setegid(bad));
            attempt(`setgroups(${shown})`, () => m.setgroups(bad));
            attempt(`initgroups(${shown})`, () => m.initgroups(bad, bad));
          }
          const after = `${m.getuid()}:${m.getgid()}:${m.geteuid()}:${m.getegid()}`;
          out.push(`credentialsMoved:${before !== after}`);
          return out.join("\n");
        },
      },
      {
        // `loadEnvFile` and `getBuiltinModule`.
        //
        // `loadEnvFile` is **always given a path**. Its no-argument form reads `.env`
        // from the working directory, and loading one would put variables into the
        // process that every later input then runs under -- and the host and the
        // child have different working directories, so the two sides would not even
        // load the same file.
        label: "process-loadenv-and-builtin",
        call: (m, s) => {
          const out = [];
          const show = (v) =>
            v === null ? "null" : v === undefined ? "undefined" : Array.isArray(v) ? "array" : typeof v;
          const attempt = (label, fn) => {
            try {
              out.push(`${label}:ok:${fn()}`);
            } catch (error) {
              out.push(`${label}:${error.code ?? error.name}`);
            }
          };
          const GONE = `/nonexistent-nts-${s.length % 5}/no-such.env`;
          attempt("loadEnvFile(missing)", () => m.loadEnvFile(GONE) ?? "void");
          for (const bad of [null, 1, true, {}, []]) {
            attempt(`loadEnvFile(${show(bad)})`, () => m.loadEnvFile(bad) ?? "void");
          }
          // `getBuiltinModule` over names that exist, names that do not, and the
          // `node:` prefix, which node accepts for some spellings and not others.
          const NAMES = ["fs", "node:fs", "path", "node:path", "nope", "node:nope",
            "http", "node:http", "", "node:", s.slice(0, 6)];
          for (let i = 0; i < NAMES.length; i++) {
            const name = NAMES[(s.length + i) % NAMES.length];
            attempt(`getBuiltinModule(${JSON.stringify(name)})`, () => {
              const got = m.getBuiltinModule(name);
              return got === undefined ? "undefined" : typeof got;
            });
          }
          for (const bad of [null, undefined, 1, {}, []]) {
            attempt(`getBuiltinModule(${show(bad)})`, () => m.getBuiltinModule(bad) ?? "void");
          }
          return out.join("\n");
        },
      },
      {
        // `finalization`'s three registrations, `ref`/`unref`, and the source-map
        // toggle.
        //
        // `finalization.register` takes a value and a callback and fires the callback
        // when the value is collected, which is not something a comparison can wait
        // for -- so what is compared is the validation and the return value, and
        // `unregister` is called for every successful registration so nothing is
        // left attached.
        //
        // `setSourceMapsEnabled` is **restored**, because it is process-wide state.
        // The host runs a preflight the child does not, so a value left behind here
        // would be read by a later input on one side only, which is how
        // `console.count` diverged before it was reset.
        label: "process-finalization-and-refs",
        call: (m, s) => {
          const out = [];
          const show = (v) =>
            v === null ? "null" : v === undefined ? "undefined" : Array.isArray(v) ? "array" : typeof v;
          const attempt = (label, fn) => {
            try {
              out.push(`${label}:ok:${fn()}`);
            } catch (error) {
              out.push(`${label}:${error.code ?? error.name}`);
            }
          };
          const BAD = [null, undefined, 1, "x", {}, []];
          for (let i = 0; i < 3; i++) {
            const bad = BAD[(s.length + i) % BAD.length];
            const shown = show(bad);
            attempt(`register(${shown})`, () => m.finalization.register(bad, () => {}) ?? "void");
            attempt(`registerBeforeExit(${shown})`, () => m.finalization.registerBeforeExit(bad, () => {}) ?? "void");
            attempt(`unregister(${shown})`, () => m.finalization.unregister(bad) ?? "void");
          }
          // A registration that succeeds, then withdrawn. The held value is local, so
          // nothing outlives the call.
          attempt("registerValid", () => {
            const held = { tag: s.length };
            m.finalization.register(held, () => {});
            m.finalization.unregister(held);
            return "registered-and-withdrawn";
          });
          attempt("registerBeforeExitValid", () => {
            const held = { tag: s.length };
            m.finalization.registerBeforeExit(held, () => {});
            m.finalization.unregister(held);
            return "registered-and-withdrawn";
          });

          // `ref`/`unref` take a handle. Nothing here is one.
          for (let i = 0; i < 3; i++) {
            const bad = BAD[(s.length + i * 2) % BAD.length];
            const shown = show(bad);
            attempt(`ref(${shown})`, () => m.ref(bad) ?? "void");
            attempt(`unref(${shown})`, () => m.unref(bad) ?? "void");
          }

          // **`setSourceMapsEnabled` is not here, and it is the one absence in this
          // module that is a missing feature rather than a decision about shape.**
          //
          // It enables source-map translation of stack traces upstream. This profile
          // has no source-map machinery, so implementing it would store a flag that
          // nothing reads -- and a caller who sets it and then expects a translated
          // trace is worse off than one who finds the function missing. That is the
          // line this file draws elsewhere too: the two profiler notifiers *are*
          // implemented, because node's are literally `() => {}` and a no-op is the
          // faithful version of a no-op.
          //
          // `getSourceMapsSupport` is not on node's `process` at all, which the first
          // version of this spec guarded on -- so that arm was inert on both sides
          // and its agreement said nothing.
          return out.join("\n");
        },
      },
      {
        // The internal accessors, each with an argument node rejects.
        //
        // `binding` and `_linkedBinding` name a native module; an unknown name is
        // refused and a wrong type is refused earlier. `dlopen` is given a descriptor
        // that is not a module object, so it fails before opening anything -- a real
        // path would load native code into the process.
        //
        // **`_debugProcess` is not here, because it cannot be called safely either
        // way.** A number is a **pid** and it sends that process SIGUSR1. And a
        // non-number **aborts node**: there is no JavaScript validation at all, so
        // the argument reaches C++ and fails `args[0]->IsNumber()` at
        // `node_process_methods.cc:401`, SIGABRT with a core dump. The first draft of
        // this spec passed non-numbers on exactly the reasoning that they were the
        // safe half, and the run died.
        //
        // That is the second node assertion this corpus reached today; the other is
        // `fs.writeFileSync(-0, "x")`. Both are recorded in
        // `docs/conformance/nodejs.md`, and both are the same shape: a JavaScript
        // argument reaching a C++ `CHECK` with nothing in between.
        //
        // Guarded by `typeof`, because two of these have come and gone across node
        // versions and a missing one should read as absent rather than as a throw
        // from calling `undefined`.
        label: "process-internal-refused",
        call: (m, s) => {
          const out = [];
          const show = (v) =>
            v === null ? "null" : v === undefined ? "undefined" : Array.isArray(v) ? "array" : typeof v;
          const attempt = (label, fn) => {
            try {
              out.push(`${label}:ok:${fn()}`);
            } catch (error) {
              out.push(`${label}:${error.code ?? error.name}`);
            }
          };
          // **`binding` and `_linkedBinding` are not here, and that is a decision.**
          //
          // They hand back node's *internal C++ bindings* by name. This profile has
          // no such table to expose -- its native side is its own -- so publishing
          // them would mean either a table that lies about what it contains or a
          // function whose every answer is an error. Node's own `binding` is
          // deprecated and emits a warning when it succeeds.
          //
          // The differential is what named them: every call answered `TypeError`
          // here, because the property does not exist, against `Error` from
          // `binding` and `ERR_INVALID_MODULE` from `_linkedBinding` on node. That
          // is a true difference and not one worth closing by inventing a registry.
          for (const bad of [null, undefined, 1, {}, []]) {
            attempt(`dlopen(${show(bad)})`, () => m.dlopen(bad, bad) ?? "void");
          }
          attempt("_debugEnd()", () => m._debugEnd() ?? "void");
          for (const name of ["_startProfilerIdleNotifier", "_stopProfilerIdleNotifier"]) {
            if (typeof m[name] === "function") {
              attempt(name, () => m[name]() ?? "void");
            } else {
              out.push(`${name}:absent`);
            }
          }
          return out.join("\n");
        },
      },
    ],
  },
  async_hooks: {
    // `AsyncLocalStorage` as a state machine: the input is a program of nested
    // `run` calls, `enterWith`, `exit` and reads, and the result is the
    // sequence of stores observed.
    //
    // Everything interesting here is nesting and restoration. A `run` inside a
    // `run` must see the inner store and the outer one must come back
    // afterwards; `exit` must make `getStore()` undefined for its callback and
    // restore on the way out; `enterWith` must persist past the call it was
    // made in, unlike `run`. None of that is reachable by calling anything
    // once, which is why this is a program rather than a value.
    //
    // Synchronous only. The whole point of `AsyncLocalStorage` is propagation
    // across an await, and comparing that means comparing *timing*, which this
    // corpus is not built for -- it would need the callback-ordering harness
    // rather than a value compare. The synchronous half is what is compared
    // here, and the asynchronous half is uncompared and named as such.
    fixed: [
      "r", "rr", "rrr", "re", "er", "rer", "w", "wr", "rw", "g",
      "rg", "rgr", "eg", "rEg", "rE", "wg", "wE", "rrE", "", "gg",
      "rwg", "wrg", "rEr", "ErE", "rrgg", "wwg", "rgE", "grg", "Erw", "rwE",
    ],
    input: (rnd) => {
      const OPS = "rewgE";
      let out = "";
      const k = 1 + Math.floor(rnd() * 8);
      for (let i = 0; i < k; i++) out += OPS[Math.floor(rnd() * OPS.length)];
      return out;
    },
    calls: [
      {
        // **The rest of `async_hooks`**, which was 5 of 18. `createHook`, `executionAsyncId`,
        // `triggerAsyncId`, `executionAsyncResource`, `AsyncResource` in full and the
        // `AsyncLocalStorage` statics were all uncalled.
        //
        // **Not one async id is compared, and that is the whole design of this spec.** Ids are
        // counters over a process's whole history: the host has run a preflight and thousands of
        // prior inputs, the child has not, so every id differs for reasons that are not defects.
        // What is compared is the *relationships* between them -- that an id is a positive
        // integer, that entering a resource's scope changes the current one and leaving restores
        // it, that a hook observes the kinds of events in the right order -- each of which is a
        // function of the input and not of when it ran.
        label: "ids-and-resources",
        call: (m, s) => {
          const attempt = (make) => {
            try { return String(make()); } catch (error) { return `${error?.code ?? error?.name ?? "?"}`; }
          };
          const label = `R${String(s).length}`;
          return [
            // An id is a positive integer, and the trigger is one too. The values differ between
            // processes; being positive integers does not.
            attempt(() => Number.isInteger(m.executionAsyncId()) && m.executionAsyncId() >= 0),
            attempt(() => Number.isInteger(m.triggerAsyncId()) && m.triggerAsyncId() >= 0),
            attempt(() => typeof m.executionAsyncResource()),
            // `runInAsyncScope` must change the current id and restore it afterwards.
            attempt(() => {
              const resource = new m.AsyncResource(label);
              const before = m.executionAsyncId();
              const inside = resource.runInAsyncScope(() => m.executionAsyncId());
              const after = m.executionAsyncId();
              return `changed:${inside !== before}|restored:${after === before}|own:${inside === resource.asyncId()}`;
            }),
            // A resource's own ids, again as relationships.
            attempt(() => {
              const resource = new m.AsyncResource(label);
              return `id:${resource.asyncId() > 0}|trigger:${resource.triggerAsyncId() >= 0}`;
            }),
            // `bind` carries the scope to a later call, so the bound function sees the resource's
            // id even though it runs outside `runInAsyncScope`.
            attempt(() => {
              const resource = new m.AsyncResource(label);
              const bound = resource.bind(() => m.executionAsyncId());
              return `bound:${bound() === resource.asyncId()}`;
            }),
            attempt(() => {
              const resource = new m.AsyncResource(label);
              resource.emitDestroy();
              return "destroyed";
            }),
            // A hook sees the kinds of event, in order. The ids it is handed are not compared;
            // that `init` precedes `destroy` for the same resource is.
            attempt(() => {
              const seen = [];
              const tracked = new Set();
              const hook = m.createHook({
                init(id, type) { if (type === label) { tracked.add(id); seen.push("init"); } },
                destroy(id) { if (tracked.has(id)) seen.push("destroy"); },
              });
              hook.enable();
              const resource = new m.AsyncResource(label);
              resource.emitDestroy();
              hook.disable();
              return `hook:${seen.join(">")}`;
            }),
            // The `AsyncLocalStorage` statics: `snapshot` captures the current context and
            // `bind` attaches it to a function.
            attempt(() => {
              const store = new m.AsyncLocalStorage();
              const inside = store.run(label, () => {
                const snapshot = m.AsyncLocalStorage.snapshot();
                return snapshot(() => store.getStore());
              });
              return `snapshot:${inside === label}|outside:${store.getStore() === undefined}`;
            }),
            attempt(() => {
              const store = new m.AsyncLocalStorage();
              const bound = store.run(label, () => m.AsyncLocalStorage.bind(() => store.getStore()));
              return `bind:${bound() === label}`;
            }),
          ].join("|");
        },
      },
      {
        label: "als-program",
        call: (m, program) => {
          const als = new m.AsyncLocalStorage();
          const log = [];
          let depth = 0;
          const read = (tag) => log.push(`${tag}:${JSON.stringify(als.getStore())}`);
          // The program is executed as a fold rather than a loop, because `run`
          // takes a callback and the remainder of the program has to run inside
          // it for nesting to mean anything.
          const step = (i) => {
            if (i >= program.length) {
              read("end");
              return;
            }
            const op = program[i];
            const n = i + 1;
            try {
              if (op === "r") {
                depth++;
                als.run({ d: depth }, () => {
                  read(`in${n}`);
                  step(i + 1);
                });
                read(`out${n}`);
              } else if (op === "e") {
                als.exit(() => {
                  read(`ex${n}`);
                  step(i + 1);
                });
                read(`unex${n}`);
              } else if (op === "w") {
                als.enterWith({ w: n });
                read(`w${n}`);
                step(i + 1);
              } else if (op === "E") {
                als.disable();
                read(`dis${n}`);
                step(i + 1);
              } else {
                read(`g${n}`);
                step(i + 1);
              }
            } catch (err) {
              log.push(`THREW${n}:${err && err.name}`);
            }
          };
          step(0);
          return log;
        },
      },
    ],
  },
  readline: {
    // The cursor functions, fuzzed over argument shapes the pinned tests do not
    // reach. `local/cursor-static.js` covers the documented calls and their
    // exact bytes; what it does not cover is what happens on `NaN`, a negative
    // count, a fractional column, `undefined` where a number is expected, or a
    // `dir` outside -1..1 -- and node has a specific answer for each, including
    // "write nothing and return true".
    //
    // The return value is compared alongside the bytes because these four
    // return a boolean that says whether the stream took the write, and a
    // reimplementation can emit the right escape and answer the wrong boolean.
    //
    // `emitKeypressEvents` and `createInterface` are not here: both attach to a
    // stream and answer over time, which is a different corpus and not one that
    // a single call can compare.
    fixed: [
      "c0,0", "c1,1", "c-1,0", "c0,-1", "cN,0", "c0,N", "c1.5,2", "cI,0",
      "m0,0", "m1,1", "m-1,-1", "m5,-5", "mN,1", "m1,N", "m1.5,-2.5", "mI,I",
      "l-1", "l0", "l1", "l2", "l-2", "lN", "lI", "lU",
      "s", "c0", "cU,0", "c0,U", "m0", "mU,U",
      "a", "abc", "E", "E[A", "E[B", "E[C", "E[D", "EE", "E[", "T", "R", "N",
      "RN", "aE[Ab", "E[1;5A", "\u0001", "\u007f", "", "EOA", "E[3~",
    ],
    input: (rnd) => {
      const NUMS = ["0", "1", "-1", "2", "-2", "5", "N", "I", "U", "1.5", "-1.5", "1e21"];
      const pick = () => NUMS[Math.floor(rnd() * NUMS.length)];
      const kind = Math.floor(rnd() * 4);
      if (kind === 0) return `c${pick()},${pick()}`;
      if (kind === 1) return `m${pick()},${pick()}`;
      if (kind === 2) return `l${pick()}`;
      return "s";
    },
    calls: [
      {
        // **`createInterface`, which this corpus excluded for answering "over time".** That was a
        // statement about the harness: an `Interface` is an async iterable and nothing could await
        // one until 2026-09-14. Over a fixed in-memory source it is entirely deterministic --
        // `readline` has no sibling substitution, so the `Readable` feeding it is node's on both
        // sides and this compares `readline` alone.
        //
        // Line splitting is where a reimplementation differs: `\n` against `\r\n`, a trailing
        // fragment with no terminator, and an empty source. The input is woven into all three.
        label: "interface-lines",
        call: async (m, s) => {
          const text = `${s}\n${s}\r\n${s}`;
          const show = async (make) => {
            try {
              return `ok:${JSON.stringify(await make())}`;
            } catch (error) {
              return `${error?.code ?? error?.name ?? "?"}`;
            }
          };
          return [
            await show(async () => {
              const rl = m.createInterface({ input: Readable.from([text]), terminal: false });
              const lines = [];
              for await (const line of rl) lines.push(line);
              rl.close();
              return lines;
            }),
            // A source that ends without a terminator: the fragment is still a line.
            await show(async () => {
              const rl = m.createInterface({ input: Readable.from([`${s}`]), terminal: false });
              const lines = [];
              for await (const line of rl) lines.push(line);
              rl.close();
              return lines;
            }),
            // Chunk boundaries must not decide where lines are: the same bytes arriving one at a
            // time have to produce the same lines.
            await show(async () => {
              const rl = m.createInterface({
                input: Readable.from(Array.from(text)),
                terminal: false,
              });
              const lines = [];
              for await (const line of rl) lines.push(line);
              rl.close();
              return lines;
            }),
            // `promises.Readline` batches escapes and writes them on `commit`, so the bytes and
            // the fact that nothing reaches the stream before `commit` are both compared.
            await show(async () => {
              if (m.promises?.Readline === undefined) return "absent";
              const written = [];
              const sink = new Writable({
                write(chunk, encoding, done) { written.push(chunk.toString("utf8")); done(); },
              });
              const writer = new m.promises.Readline(sink);
              writer.cursorTo(String(s).length % 7, 2).moveCursor(1, -1).clearLine(0);
              const beforeCommit = written.length;
              await writer.commit();
              return [beforeCommit, JSON.stringify(written.join(""))];
            }),
          ].join("|");
        },
      },

      {
        // `emitKeypressEvents`, the last of `readline`'s three uncompared
        // names. It turns bytes on a stream into `'keypress'` events, and the
        // decoding is a state machine: an escape sequence arrives as several
        // chunks and must be held until it is complete, a lone `\x1b` is the
        // Escape key, and `\x1b[A` is Up with no Escape emitted before it.
        //
        // Synchronous end to end -- the stream is fed and the events land
        // before `push` returns -- so a value comparison holds it. What is
        // compared is the *sequence* of `(name, ctrl, meta, shift)` tuples,
        // because a decoder that produces the right keys in the wrong order,
        // or splits one sequence into two, answers every single-key test.
        label: "keypress-decode",
        call: (m, spec) => {
          const seen = [];
          let input;
          try {
            input = new Readable({ read() {} });
            input.setEncoding("utf8");
            m.emitKeypressEvents(input);
          } catch (e) {
            return `SETUP:${(e && e.code) || (e && e.name)}`;
          }
          input.on("keypress", (ch, key) => {
            seen.push(`${key ? key.name : "?"}:${key && key.ctrl ? "c" : "-"}${key && key.meta ? "m" : "-"}${key && key.shift ? "s" : "-"}`);
          });
          const bytes = spec
            .replace(/E/g, "\u001b")
            .replace(/T/g, "\t")
            .replace(/R/g, "\r")
            .replace(/N/g, "\n");
          try {
            input.push(bytes);
            input.read();
          } catch (e) {
            seen.push(`THREW:${(e && e.code) || (e && e.name)}`);
          }
          return seen;
        },
      },
      {
        label: "cursor-op",
        call: (m, spec) => {
          const num = (t) => {
            if (t === "N") return NaN;
            if (t === "I") return Infinity;
            if (t === "U") return undefined;
            return Number(t);
          };
          let written = "";
          const stream = new Writable({
            write(chunk, _enc, cb) {
              written += String(chunk);
              cb();
            },
          });
          const op = spec[0];
          const args = spec.slice(1).split(",");
          let returned;
          try {
            if (op === "c") returned = m.cursorTo(stream, num(args[0]), num(args[1]));
            else if (op === "m") returned = m.moveCursor(stream, num(args[0]), num(args[1]));
            else if (op === "l") returned = m.clearLine(stream, num(args[0]));
            else returned = m.clearScreenDown(stream);
          } catch (e) {
            return [`THREW:${e && e.name}`, e && e.code ? String(e.code) : ""];
          }
          return [written, String(returned)];
        },
      },

      // **`Interface`'s line-editing internals**, which were 26 of readline's 38
      // published functions and none of them called.
      //
      // The section header says `createInterface` is excluded because it attaches
      // to a stream and answers over time. That is true of the *events* it emits
      // and not of these: `_wordLeft`, `_deleteWordRight`, `_insertString` and the
      // rest each rewrite `line` and `cursor` synchronously and return nothing, so
      // the state after a sequence of them is a value and a function of the input.
      //
      // This is where cursor arithmetic lives, which is the part of readline most
      // likely to be subtly wrong: word movement has to agree with word deletion
      // about where a word starts, and `_getDisplayPos` has to agree with both
      // about how wide a character is.
      //
      // The interface is built over an in-memory `Readable` and a capturing
      // `Writable`. Neither is a libuv handle, so neither holds the loop open, and
      // `close()` runs at the end regardless.
      {
        label: "line-editing-internals",
        call: async (m, s) => {
          const { Readable, Writable } = await import("node:stream");
          const ESC = String.fromCharCode(27);
          const written = [];
          const output = new Writable({
            write(chunk, _encoding, cb) { written.push(String(chunk)); cb(); },
          });
          output.columns = 40;
          output.rows = 10;
          const input = new Readable({ read() {} });
          input.isTTY = true;
          input.setRawMode = () => {};

          const lines = [];
          let rl;
          try {
            rl = m.createInterface({
              input,
              output,
              terminal: true,
              prompt: "> ",
              historySize: 4,
              completer: (line) => [
                ["alpha", "beta", "betamax"].filter((c) => c.startsWith(line)),
                line,
              ],
            });
          } catch (error) {
            return `createInterface:${error.code || error.name}`;
          }
          rl.on("line", (line) => lines.push(line));

          const log = [];
          const snap = (tag) => log.push(`${tag}|${JSON.stringify(rl.line)}|${rl.cursor}`);

          // Seed the line so the editing operations have material, with a word
          // boundary in it: word movement and word deletion have to agree about
          // where a word begins.
          rl._insertString(["alpha beta", "a b  c", "unicode word", "one"][s.length % 4]);
          snap("seed");

          // The operations, chosen by the input's own characters so which sequence
          // runs is a function of the input rather than of this spec.
          const OPS = [
            ["wordLeft", () => rl._wordLeft()],
            ["wordRight", () => rl._wordRight()],
            ["deleteLeft", () => rl._deleteLeft()],
            ["deleteRight", () => rl._deleteRight()],
            ["deleteWordLeft", () => rl._deleteWordLeft()],
            ["deleteWordRight", () => rl._deleteWordRight()],
            ["deleteLineLeft", () => rl._deleteLineLeft()],
            ["deleteLineRight", () => rl._deleteLineRight()],
            ["moveMinus2", () => rl._moveCursor(-2)],
            ["movePlus3", () => rl._moveCursor(3)],
            ["insertX", () => rl._insertString("X")],
            ["insertWide", () => rl._insertString("nihon")],
            ["refresh", () => rl._refreshLine()],
            ["cursorPos", () => log.push(`cursorPos|${JSON.stringify(rl._getCursorPos())}`)],
            ["displayPos", () => log.push(`displayPos|${JSON.stringify(rl._getDisplayPos(rl.line))}`)],
            ["writeOut", () => rl._writeToOutput("|out|")],
            ["setRawTrue", () => rl._setRawMode(true)],
            ["setRawFalse", () => rl._setRawMode(false)],
          ];
          for (let i = 0; i < s.length && i < 8; i++) {
            const [name, run] = OPS[s.charCodeAt(i) % OPS.length];
            try {
              run();
              snap(name);
            } catch (error) {
              log.push(`${name}|threw:${error.code || error.name}`);
            }
          }

          // `_deleteLeft` and `_deleteRight` unconditionally, because the rotation
          // above never selected them: an operation is picked by `charCodeAt(i) %
          // 18`, and across the whole corpus no input's characters landed on those
          // two indices. `corpus-reach.mjs` reported exactly that -- 36 of 38, with
          // these the only pair left -- which is the case a spec that *contains* a
          // call still does not make.
          //
          // Still a function of the input: they act on whatever line and cursor the
          // rotation above produced, so the result differs per input even though
          // the call does not.
          for (const [name, run] of [
            ["tailDeleteLeft", () => rl._deleteLeft()],
            ["tailDeleteRight", () => rl._deleteRight()],
          ]) {
            try {
              run();
              snap(name);
            } catch (error) {
              log.push(`${name}|threw:${error.code || error.name}`);
            }
          }

          // History: `_addHistory` commits the line and the two navigators walk it.
          // `historySize: 4` means the fifth entry evicts the first, which is the
          // part an unbounded implementation gets wrong.
          try {
            for (const entry of ["first", "second", "third", "fourth", "fifth"]) {
              rl.line = entry;
              rl.cursor = entry.length;
              log.push(`addHistory|${JSON.stringify(rl._addHistory())}`);
            }
            log.push(`history|${JSON.stringify(rl.history)}`);
            rl._historyPrev();
            snap("historyPrev1");
            rl._historyPrev();
            snap("historyPrev2");
            rl._historyNext();
            snap("historyNext");
          } catch (error) {
            log.push(`history|threw:${error.code || error.name}`);
          }

          // `_tabComplete` consults the completer and either completes uniquely or
          // lists candidates. "beta" is deliberately a prefix of "betamax", so the
          // ambiguous branch is reachable.
          try {
            rl.line = ["al", "beta", "zzz", ""][s.length % 4];
            rl.cursor = rl.line.length;
            rl._tabComplete(false);
            await new Promise((resolve) => queueMicrotask(resolve));
            await new Promise((resolve) => setImmediate(resolve));
            snap("tabComplete");
          } catch (error) {
            log.push(`tabComplete|threw:${error.code || error.name}`);
          }

          try {
            rl.line = "committed";
            rl.cursor = 9;
            rl._line();
            snap("line");
            log.push(`emitted|${JSON.stringify(lines)}`);
          } catch (error) {
            log.push(`line|threw:${error.code || error.name}`);
          }

          // `_ttyWrite` is the dispatcher every keypress goes through, so driving
          // it reaches the bindings rather than the methods directly. The character
          // is empty for the control bindings because node dispatches those on
          // `key.ctrl` and `key.name`, not on what was typed.
          const KEYS = [
            ["plain", "z", { name: "z" }],
            ["ctrlA", "", { name: "a", ctrl: true }],
            ["ctrlE", "", { name: "e", ctrl: true }],
            ["ctrlK", "", { name: "k", ctrl: true }],
            ["ctrlU", "", { name: "u", ctrl: true }],
            ["ctrlW", "", { name: "w", ctrl: true }],
            ["backspace", "", { name: "backspace" }],
            ["left", undefined, { name: "left" }],
            ["right", undefined, { name: "right" }],
            ["metaB", undefined, { name: "b", meta: true }],
            ["metaF", undefined, { name: "f", meta: true }],
            ["metaD", undefined, { name: "d", meta: true }],
            ["home", undefined, { name: "home" }],
            ["end", undefined, { name: "end" }],
          ];
          rl.line = "alpha beta gamma";
          rl.cursor = 6;
          for (let i = 0; i < s.length && i < 6; i++) {
            const [name, ch, key] = KEYS[(s.charCodeAt(i) * 7 + i) % KEYS.length];
            try {
              rl._ttyWrite(ch, key);
              snap(`tty:${name}`);
            } catch (error) {
              log.push(`tty:${name}|threw:${error.code || error.name}`);
            }
          }

          // `question` writes its prompt and holds the line until one is
          // committed, which `_line` does synchronously here -- so it settles.
          try {
            const answered = await new Promise((resolve) => {
              rl.question("pick? ", (answer) => resolve(answer));
              rl.line = "picked";
              rl.cursor = 6;
              rl._line();
            });
            log.push(`question|${JSON.stringify(answered)}`);
          } catch (error) {
            log.push(`question|threw:${error.code || error.name}`);
          }

          rl.close();
          input.destroy();
          output.destroy();

          // The bytes the interface wrote. Escape sequences are the point, so they
          // are kept and the ESC byte is spelled out, which keeps the comparison
          // readable through the probe's JSON.
          const bytes = written.join("").replaceAll(ESC, "<ESC>");
          return `${log.join("\n")}\nwritten:${JSON.stringify(bytes)}`;
        },
      },
      {
        // The promises API, a separate published surface: its own
        // `createInterface`, its own `Interface#question` taking no callback, and
        // `Readline`'s `clearScreenDown` and `rollback`.
        //
        // `rollback` is the one worth comparing. `Readline` queues operations and
        // `commit` flushes them; `rollback` discards the queue instead, so the
        // observable is that **nothing** was written -- which an implementation
        // that writes eagerly passes every other check and fails here.
        label: "readline-promises",
        call: async (m, s) => {
          const { Readable, Writable } = await import("node:stream");
          const ESC = String.fromCharCode(27);
          const written = [];
          const output = new Writable({
            write(chunk, _encoding, cb) { written.push(String(chunk)); cb(); },
          });
          output.columns = 40;
          output.rows = 10;
          const input = new Readable({ read() {} });
          const out = [];

          try {
            const readline = new m.promises.Readline(output);
            readline.cursorTo(1 + (s.length % 5), 2).clearScreenDown();
            out.push(`beforeRollback:${written.length}`);
            await readline.rollback();
            out.push(`afterRollback:${written.length}`);
            readline.cursorTo(0, 0).clearScreenDown();
            await readline.commit();
            out.push(`afterCommit:${JSON.stringify(written.join("").replaceAll(ESC, "<ESC>"))}`);
          } catch (error) {
            out.push(`readline:${error.code || error.name}`);
          }

          try {
            const rl = m.promises.createInterface({ input, output, terminal: false });
            const pending = rl.question("q? ");
            // Pushed into the input rather than emitted as a `line` event. The
            // promises `question` resolves from the interface's own line handler,
            // which an external `emit("line", ...)` walks straight past -- so the
            // promise stayed pending, the loop drained, and the first run of this
            // spec died with node's unsettled-top-level-await warning rather than
            // an answer.
            input.push(`answer${s.length % 3}\n`);
            input.push(null);
            out.push(`question:${JSON.stringify(await pending)}`);
            rl.close();
          } catch (error) {
            out.push(`question:${error.code || error.name}`);
          }

          input.destroy();
          output.destroy();
          return out.join("\n");
        },
      },
    ],
  },
  diagnostics_channel: {
    // A state-machine fuzz, third of its kind here after `events` and
    // `console`, and for the same reason: nothing about a channel is a value
    // in and a value out. What matters is *when* a subscriber sees a message
    // and whether `hasSubscribers` agrees at that moment.
    //
    // The subtleties this reaches and a value fuzz cannot: publishing to a
    // channel nobody holds a reference to, subscribing twice with the same
    // function, unsubscribing during a publish that is walking the subscriber
    // list, `hasSubscribers` in the middle of that walk, and whether
    // `channel(name)` twice returns the same object.
    //
    // Channel names carry a per-invocation counter, not just the program text.
    // Node keeps a **process-wide registry keyed by name**, so a name reused
    // across iterations lets iteration N see iteration N-1's subscribers.
    //
    // Deriving the name from the program text alone was not enough and the
    // first run said so: the same program appears twice -- `"sp"` is in
    // `fixed` and the generator emits it too -- and the second occurrence
    // inherited the first's subscriber, so one publish logged twice. Six
    // divergences over 420 inputs, all of them this file. The counter is what
    // makes each invocation its own channel, and it is deterministic because
    // both sides walk the same inputs in the same order.
    fixed: [
      "sp", "ssp", "sup", "spu", "pp", "s", "p", "", "sppu", "ssuup",
      "shp", "hsp", "sphp", "ssp", "supp", "sdp", "dsp", "spd", "ssppuu", "hh",
      // The instance forms, in `fixed` and not only in the generator, because
      // `corpus-reach.mjs` walks the fixed inputs -- an op that exists only in
      // the random alphabet is exercised by the differential and invisible to the
      // coverage question. Adding them to `OPS` alone left `Channel#unsubscribe`
      // still reading "never called".
      "Sp", "SUp", "SpU", "SSUp", "SUUp", "sUp", "Suh", "SpSp", "USp", "ShUp",
    ],
    input: (rnd) => {
      const OPS = "spuhdUS";
      let out = "";
      const k = 1 + Math.floor(rnd() * 8);
      for (let i = 0; i < k; i++) out += OPS[Math.floor(rnd() * OPS.length)];
      return out;
    },
    calls: [
      {
        // `tracingChannel` and `Channel`, the two names this corpus did not
        // reach. `traceSync` has an **ordering contract**, and ordering is the
        // half a value comparison usually cannot hold — here it can, because
        // the whole sequence is synchronous and the subscriber writes a log.
        //
        //     normal   start,end
        //     throwing start,error,end     <- `error` before `end`, not after
        //
        // A reimplementation that emits `error` after `end`, or skips `end`
        // when the traced function throws, answers every single-event test
        // correctly and gets this wrong.
        label: "tracing-channel",
        call: (m, program) => {
          const name = `nts-trace-${program || "empty"}-${++dcInvocation}`;
          let tc;
          try {
            tc = m.tracingChannel(name);
          } catch (e) {
            return `NO-TRACING:${(e && e.code) || (e && e.name)}`;
          }
          const seen = [];
          const handlers = {};
          for (const ev of ["start", "end", "asyncStart", "asyncEnd", "error"]) {
            handlers[ev] = () => seen.push(ev);
          }
          const out = [`channels:${Object.getOwnPropertyNames(tc).sort().join(",")}`];
          try {
            out.push(`subs-before:${tc.hasSubscribers}`);
            tc.subscribe(handlers);
            out.push(`subs-after:${tc.hasSubscribers}`);
            const r = tc.traceSync(() => 42, {});
            out.push(`ok:${r}`, `order:${seen.join(",")}`);
            seen.length = 0;
            try {
              tc.traceSync(() => {
                throw new Error("boom");
              }, {});
            } catch (e) {
              out.push(`threw:${e && e.message}`);
            }
            out.push(`throw-order:${seen.join(",")}`);
            tc.unsubscribe(handlers);
            out.push(`subs-end:${tc.hasSubscribers}`);
          } catch (e) {
            out.push(`THREW:${(e && e.code) || (e && e.name)}`);
          }
          return out;
        },
      },
      {
        // `Channel` as a constructor: node exposes the class, and a channel
        // built directly must behave as one from `channel(name)` does.
        label: "Channel-class",
        call: (m, program) => {
          const out = [`is-fn:${typeof m.Channel}`];
          try {
            const named = m.channel(`nts-cls-${program || "e"}-${++dcInvocation}`);
            out.push(`instance:${named instanceof m.Channel}`);
            out.push(`name-type:${typeof named.name}`);
            out.push(`hasSubscribers:${named.hasSubscribers}`);
          } catch (e) {
            out.push(`THREW:${(e && e.code) || (e && e.name)}`);
          }
          return out;
        },
      },
      {
        label: "channel-program",
        call: (m, program) => {
          // The name has to be unique per program and identical on both sides,
          // so it is derived from the program text and nothing else.
          const name = `nts-diff-${program || "empty"}-${++dcInvocation}`;
          const log = [];
          const made = [];
          let seq = 0;
          const listener = (tag) => {
            const fn = (msg) => log.push(`${tag}:${JSON.stringify(msg)}`);
            made.push(fn);
            return fn;
          };
          let ch;
          try {
            ch = m.channel(name);
          } catch (e) {
            return `CHANNEL-FAILED:${e && e.name}`;
          }
          for (const op of program) {
            seq++;
            try {
              if (op === "s") m.subscribe(name, listener(`s${seq}`));
              else if (op === "u") {
                const fn = made.length > 0 ? made[made.length - 1] : () => {};
                log.push(`u${seq}:${m.unsubscribe(name, fn)}`);
              } else if (op === "U") {
                // The **instance** form. `dc.unsubscribe(name, fn)` and
                // `channel.unsubscribe(fn)` are separate entry points to the same
                // registry, and only the module-level one was reached -- an
                // implementation where the instance method forgets to update the
                // shared registry answers correctly to every op above and wrongly
                // to this one.
                const fn = made.length > 0 ? made[made.length - 1] : () => {};
                log.push(`U${seq}:${ch.unsubscribe(fn)}:hs=${ch.hasSubscribers}`);
              } else if (op === "S") {
                // And the instance form of subscribe, for the same reason.
                ch.subscribe(listener(`S${seq}`));
                log.push(`S${seq}:hs=${m.hasSubscribers(name)}`);
              } else if (op === "p") {
                log.push(`hs${seq}:${ch.hasSubscribers}`);
                ch.publish({ n: seq });
              } else if (op === "h") {
                log.push(`h${seq}:${m.hasSubscribers(name)}`);
              } else if (op === "d") {
                // The same name twice must be the same object; node keys a
                // process-wide registry by name and a reimplementation that
                // builds a fresh channel each time passes every single-channel
                // test and breaks every cross-module one.
                log.push(`d${seq}:${m.channel(name) === ch}`);
              }
            } catch (e) {
              log.push(`THREW${seq}:${e && e.name}`);
            }
          }
          return log;
        },
      },
    ],
  },
  console: {
    // A state-machine fuzz like `events`, and for the same reason: `console`'s
    // behaviour is what it *writes*, and the parts worth comparing are stateful.
    // `group` indentation nests and applies to every subsequent line including
    // multi-line ones; `count` keeps a tally per label; `countReset` clears one
    // label and not the others. No single call reaches any of that -- only an
    // order of calls does.
    //
    // **Deterministic operations only.** `time`/`timeEnd` write an elapsed
    // duration and `trace` writes a stack, so both would diverge on every run
    // for reasons that are not defects. They are excluded rather than
    // normalised: normalising them would mean inventing the answer, and a
    // comparison against an answer this file made up is not a comparison.
    //
    // `countReset` is excluded for a different reason and it is worth the line.
    // Resetting a label that was never counted emits a **process** warning --
    // "Count for 'k' does not exist" -- rather than writing to the console's own
    // streams, so this corpus has no channel to compare it on. Suppressing the
    // warning to keep the output readable is exactly the mistake that once hid a
    // real difference two tests depended on, so the operation is dropped instead
    // and named here as uncompared.
    //
    // Both streams are captured and returned together, because `warn`, `error`
    // and a failing `assert` go to stderr while the rest go to stdout, and
    // which stream a line lands on is exactly the kind of thing a
    // reimplementation gets wrong without any test noticing.
    fixed: [
      "l", "lg", "lgl", "lglG", "lgGl", "cc", "ccc", "ccl", "ew", "a",
      "lew", "gggl", "GGl", "d", "ld", "gdG", "cgcG", "lgglGGl", "", "n",
      "ngl", "aew", "lcl", "gcGc", "nnn", "lGl", "gagG", "cdc", "lnd", "gng",
      "i", "b", "ib", "t", "T", "u", "gt", "gTG", "itb", "tT", "lut", "gigb",
    ],
    input: (rnd) => {
      const OPS = "lnewagGcdibtTu";
      let out = "";
      const k = 1 + Math.floor(rnd() * 10);
      for (let i = 0; i < k; i++) out += OPS[Math.floor(rnd() * OPS.length)];
      return out;
    },
    calls: [
      {
        // **The module-level functions, which write to `process.stdout` and so were unreachable.**
        //
        // This corpus drives a `Console` built over two collecting streams, which is why
        // `corpus-reach.mjs` reported `Console#log` as called and plain `log` as never called:
        // they are different functions, and the bound ones are the pair every program actually
        // uses. Reaching them means capturing the process's own streams.
        //
        // `write` is swapped and restored in a `finally`, because **the probe reports its answer
        // on stdout**: a capture that leaked would eat the `NTSDIFF` line and the host would see
        // a module that produced no results rather than one that diverged.
        //
        // The same exclusions as the instance spec below, for the same reasons: `time`/`timeEnd`
        // write an elapsed duration and `trace` writes a stack, so both would differ every run
        // for reasons that are not defects.
        label: "bound-console",
        call: (m, s) => {
          const out = [];
          const err = [];
          const realOut = process.stdout.write;
          const realErr = process.stderr.write;
          process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
          process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
          try {
            const attempt = (make) => {
              try { make(); } catch (error) { out.push(`threw:${error?.code ?? error?.name ?? "?"}`); }
            };
            attempt(() => m.log("%s|%d", s, s.length));
            attempt(() => m.info(s));
            attempt(() => m.debug(s));
            attempt(() => m.warn(s));
            attempt(() => m.error(s));
            attempt(() => m.dir({ value: s, nested: { deep: [s] } }));
            attempt(() => m.dirxml(s));
            attempt(() => m.assert(s.length % 2 === 0, "assertion about %s", s));
            // `count` keeps a tally per label and `group` indents everything after it,
            // including the multi-line output of `dir`. Both are state, and state is where a
            // reimplementation of `console` actually differs.
            //
            // **The tally is reset at the end, because the bound console is a singleton and its
            // state outlives one input.** Without the reset this diverged on 28 inputs with
            // `l: 13` against `l: 15`: `differential-ts.mjs` runs a preflight over `corpus.fixed`
            // on the **node side only**, to check node itself answers, so the host's counter was
            // a few ahead of the child's for the whole run. The values were never wrong -- the
            // spec was not a function of its input, which is the one property a spec needs.
            //
            // Resetting also reaches `countReset`, which the instance spec below excludes: it
            // warns when the label does not exist, and here it always does.
            attempt(() => m.count(s.slice(0, 3)));
            attempt(() => m.count(s.slice(0, 3)));
            attempt(() => m.countReset(s.slice(0, 3)));
            attempt(() => m.group("g:%s", s));
            attempt(() => m.log(`inside\n${s}`));
            attempt(() => m.groupCollapsed("deeper"));
            attempt(() => m.dir([s, { k: s }]));
            attempt(() => m.groupEnd());
            attempt(() => m.groupEnd());
            attempt(() => m.log("after"));
            attempt(() => m.table([{ a: s, b: s.length }, { a: "x", b: 1 }]));
            attempt(() => m.clear());
          } finally {
            process.stdout.write = realOut;
            process.stderr.write = realErr;
          }
          return `out=${JSON.stringify(out.join(""))}|err=${JSON.stringify(err.join(""))}`;
        },
      },

      {
        label: "console-program",
        call: (m, program) => {
          let outText = "";
          let errText = "";
          // A real `Writable`, not a duck-typed object with a `write`. The
          // first version of this was the latter and **node's `Console` wrote
          // nothing to it** while ours wrote correctly -- 423 divergences over
          // 430 inputs, every one of them this harness rather than the module.
          // A sink node does not accept turns the whole corpus into a report
          // that the module under test is right and node is empty.
          const sink = (append) =>
            new Writable({
              write(chunk, _enc, cb) {
                append(String(chunk));
                cb();
              },
            });
          const stdout = sink((t) => {
            outText += t;
          });
          const stderr = sink((t) => {
            errText += t;
          });
          let con;
          try {
            con = new m.Console({ stdout, stderr });
          } catch {
            return "CONSTRUCT-FAILED";
          }
          let n = 0;
          for (const op of program) {
            n++;
            try {
              if (op === "l") con.log(`line${n}`);
              else if (op === "n") con.log("%d and %s", n, `s${n}`);
              else if (op === "e") con.error(`err${n}`);
              else if (op === "w") con.warn(`warn${n}`);
              else if (op === "a") con.assert(false, `assert${n}`);
              else if (op === "g") con.group(`g${n}`);
              else if (op === "G") con.groupEnd();
              else if (op === "c") con.count("k");
              else if (op === "d") con.dir({ a: { b: { c: n } } });
              // `info` and `debug` are aliases of `log` on node and route to stdout;
              // a reimplementation that defines them as *the same function object*
              // rather than as separate ones passes every other check here. Driving
              // them separately is what makes the stream they land on comparable.
              else if (op === "i") con.info(`info${n}`);
              else if (op === "b") con.debug(`debug${n}`);
              // `table` is the richest formatter in the module -- column discovery,
              // alignment, the index column -- and it was uncompared. Three shapes:
              // rows of objects with differing keys, an array of primitives, and a
              // non-tabular value node falls back to `log` for.
              else if (op === "t") con.table([{ a: 1, b: `x${n}` }, { b: 2, c: null }]);
              else if (op === "T") con.table([1, "two", null]);
              else if (op === "u") con.table(`not tabular ${n}`);
            } catch (e) {
              outText += `THREW:${e && e.name}\n`;
            }
          }
          return [outText, errText];
        },
      },
      {
        // **The deterministic remainder of `console`**, which is eight of the fifteen
        // names nothing called.
        //
        // The section header excludes `time`, `timeEnd`, `timeLog` and `trace` because
        // the first three write an elapsed duration and the fourth writes a stack, and
        // it argues that normalising them "would mean inventing the answer, and a
        // comparison against an answer this file made up is not a comparison". That
        // argument holds and the three timers stay out. What it does not cover:
        //
        //   - `clear`, `profile`, `profileEnd` and `timeStamp` involve no duration and
        //     no stack at all. The last three are no-ops without an inspector attached,
        //     and a no-op is a perfectly comparable answer.
        //   - `context` and `createTask` answer objects, and their shape is fixed.
        //   - `countReset` was excluded because resetting a label that was **never
        //     counted** emits a process warning with no channel to compare it on. That
        //     is true of the uncounted case and only of it: resetting a label that was
        //     counted writes nothing and is visible in the next `count`, which is the
        //     arm here.
        //   - `trace`'s **first line** is `Trace: ` followed by the formatted arguments,
        //     and that is a function of the input. Only the frames are not — and their
        //     *count* differs between the two sides by construction, because the host
        //     evaluates specs inside the harness and the probe inside a child, at
        //     different stack depths. So the frames are dropped and the first line is
        //     compared. Dropping a part that cannot agree is not the same as inventing
        //     a value for it: nothing here is replaced by a made-up answer, and if the
        //     first line diverges the row still says so.
        label: "console-deterministic-rest",
        call: async (m, s) => {
          const { Writable } = await import("node:stream");
          const captured = [];
          const sink = () => new Writable({
            write(chunk, _encoding, cb) { captured.push(String(chunk)); cb(); },
          });
          const stdout = sink();
          const stderr = sink();
          const instance = new m.Console({ stdout, stderr });
          const out = [];
          const attempt = (label, fn) => {
            try {
              const got = fn();
              out.push(`${label}:ok:${got === undefined ? "void" : typeof got}`);
            } catch (error) {
              out.push(`${label}:${error.code ?? error.name}`);
            }
          };
          const label = (s.replace(/[^a-zA-Z0-9]/g, "") || "k").slice(0, 6);

          // `countReset` on a label that was counted, which is the deterministic half.
          attempt("count1", () => instance.count(label));
          attempt("count2", () => instance.count(label));
          attempt("countOther", () => instance.count(`${label}-other`));
          attempt("countReset", () => instance.countReset(label));
          attempt("countAfterReset", () => instance.count(label));
          attempt("countOtherAgain", () => instance.count(`${label}-other`));

          attempt("clear", () => instance.clear());

          // `trace`, first line only. The frames differ in *number* between the two
          // sides because the stack depth does, so they are cut rather than matched.
          attempt("trace", () => instance.trace(label, s.length % 5, { a: 1 }));
          attempt("traceNoArgs", () => instance.trace());

          const text = captured.join("");
          const firstLines = text
            .split("\n")
            .filter((line) => !/^\s+at /.test(line))
            .join("\n");
          out.push(`written:${JSON.stringify(firstLines)}`);
          out.push(`frameLinesPresent:${/\n\s+at /.test(text)}`);

          // The three the global console has and an instance does not, which is itself
          // worth a row: they belong to the inspector surface rather than to `Console`.
          for (const name of ["profile", "profileEnd", "timeStamp"]) {
            out.push(`onInstance:${name}:${typeof instance[name]}`);
            out.push(`onModule:${name}:${typeof m[name]}`);
            attempt(`module:${name}`, () =>
              typeof m[name] === "function" ? m[name](label) : "ABSENT");
          }
          // Called a second time, because an unbalanced `profileEnd` is the case a
          // counter-based implementation gets wrong.
          attempt("profileEndAgain", () =>
            typeof m.profileEnd === "function" ? m.profileEnd(label) : "ABSENT");
          attempt("profileEndUnknown", () =>
            typeof m.profileEnd === "function" ? m.profileEnd(`${label}-never`) : "ABSENT");

          // `context` answers a fresh console and `createTask` a task object. Compared
          // through shape and through whether the new console is the old one, because a
          // `context()` that answered the same object would look right until two
          // contexts shared a `count` tally.
          attempt("context", () => {
            const fresh = m.context();
            return `${typeof fresh}|same:${fresh === m}|hasLog:${typeof fresh.log}` +
              `|hasCount:${typeof fresh.count}`;
          });
          attempt("createTask", () => {
            const task = m.createTask(`task-${label}`);
            // `run.length` is part of it: node's is 0 and a declared parameter would
            // report 1, which every behavioural row would still agree on.
            return `${typeof task}|run:${typeof task.run}|arity:${task.run.length}` +
              `|own:${Object.getOwnPropertyNames(task).sort().join(",")}` +
              `|ran:${task.run(() => `v${label}`)}`;
          });
          attempt("createTaskArity", () => `${m.createTask.length}|${m.context.length}`);
          for (const bad of [undefined, null, 1, {}]) {
            attempt(`createTaskBad:${bad === null ? "null" : typeof bad}`, () =>
              typeof m.createTask(bad));
          }
          return out.join("\n");
        },
      },
    ],
  },
};
