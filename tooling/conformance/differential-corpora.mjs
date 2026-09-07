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
    ],
    input: (rnd) => {
      const PARTS = ["a", "bb", ".", "..", "", "c.txt", "d.", ".e", "f g", "ü", "日", "...", "x.y.z"];
      const SEPS = ["/", "//", "///", "/./", "/../"];
      let s = rnd() < 0.4 ? "/" : "";
      const k = 1 + Math.floor(rnd() * 5);
      for (let j = 0; j < k; j++) s += (j ? choose(rnd, SEPS) : "") + choose(rnd, PARTS);
      if (rnd() < 0.2) s += choose(rnd, SEPS);
      return s;
    },
    calls: [
      { name: "normalize", args: (s) => [s] },
      { name: "dirname", args: (s) => [s] },
      { name: "basename", args: (s) => [s] },
      { name: "extname", args: (s) => [s] },
      { name: "isAbsolute", args: (s) => [s] },
      { name: "parse", args: (s) => [s] },
      { name: "join", args: (s) => [s, "z"] },
      { name: "resolve", args: (s) => [s] },
      { name: "relative", args: (s) => [s, "/tmp"] },
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
