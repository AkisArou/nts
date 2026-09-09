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
