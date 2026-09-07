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

export const CORPORA = {
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
    ],
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
};
