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
import { Writable } from "node:stream";

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
      { label: "freemem:shape", call: (os) => typeof os.freemem() },
      { label: "uptime:shape", call: (os) => typeof os.uptime() },
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
        { label: "existsSync", call: (m, s) => attempt(() => m.existsSync(BASE + s)) },
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
    calls: [
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
    ],
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
    calls: [
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
        // The two tables, compared whole once per input rather than per key.
        // `STATUS_CODES` is 63 entries of prose and `METHODS` is an ordered
        // list; a missing or misspelled entry in either is invisible to every
        // pinned test that does not happen to use that code.
        label: "tables",
        call: (m) => [
          Object.keys(m.STATUS_CODES).length,
          m.STATUS_CODES[200],
          m.STATUS_CODES[404],
          m.STATUS_CODES[418],
          m.STATUS_CODES[451],
          Array.isArray(m.METHODS) ? m.METHODS.length : "not-array",
          Array.isArray(m.METHODS) ? m.METHODS.join(",") : "",
        ],
      },
    ],
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
    calls: [
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
    ],
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
    ],
    input: (rnd) => {
      const OPS = "spuhd";
      let out = "";
      const k = 1 + Math.floor(rnd() * 8);
      for (let i = 0; i < k; i++) out += OPS[Math.floor(rnd() * OPS.length)];
      return out;
    },
    calls: [
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
    ],
    input: (rnd) => {
      const OPS = "lnewagGcd";
      let out = "";
      const k = 1 + Math.floor(rnd() * 10);
      for (let i = 0; i < k; i++) out += OPS[Math.floor(rnd() * OPS.length)];
      return out;
    },
    calls: [
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
            } catch (e) {
              outText += `THREW:${e && e.name}\n`;
            }
          }
          return [outText, errText];
        },
      },
    ],
  },
};
