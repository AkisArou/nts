// Generate RegExp Unicode cases using the repository's exact Node oracle.
// Run: node tooling/unicode-cases/regexp.ts [--check] [--data-dir=/path/to/UCD] [--output-dir=/path]
// After reviewing version, inventory and data pins, use a clean output directory
// to review expectations for a Node upgrade before replacing any recorded cases.
// Unicode inputs are fetched from their official versioned URLs or read from --data-dir.
// Both input files must match their SHA-256 pins before any cases are written.
// The generator has no npm dependency and writes only regexp-*.ts.
// All expected booleans and block hashes are computed by Node, never from nts.
//
// Property inventory: ECMA-262 revision 837168a438620a119970f2759756fd7b4e947719.
// https://github.com/tc39/ecma262/blob/837168a438620a119970f2759756fd7b4e947719/table-binary-unicode-properties.html
// SHA-256 bb09794cb0cf887f011f5d1a133b2a29734e432ba0cf87db9281afbd151b8ea0
// https://github.com/tc39/ecma262/blob/837168a438620a119970f2759756fd7b4e947719/table-binary-unicode-properties-of-strings.html
// SHA-256 9c4e35660c28217fb8dd7786de72010c30f901e534a57e3c16eef4831d6bf0e1
// Category names: https://www.unicode.org/Public/17.0.0/ucd/PropertyValueAliases.txt
// SHA-256 64e9a5f76f7a1e8b5a47d6a1f9a26522a251208f5276bdfa1559dac7cf2e827a
// Candidate fold pairs: https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt
// SHA-256 ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183
// The 1512 C/S mappings supply comparison inputs, not expected answers.
// These derived Unicode 17.0.0 data retain the source notice:
// Copyright 2025 Unicode, Inc. Unicode and the Unicode Logo are registered
// trademarks of Unicode, Inc. in the U.S. and other countries.
// Terms of use and license: https://www.unicode.org/terms_of_use.html

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const NODE = "24.20.0", UNICODE = "17.0", ICU = "78.3";
if (process.versions.node !== NODE || process.versions.unicode !== UNICODE || process.versions.icu !== ICU) {
  throw new Error(`RegExp cases require Node ${NODE}, Unicode ${UNICODE}, ICU ${ICU}; got ` +
    `Node ${process.versions.node}, Unicode ${process.versions.unicode}, ICU ${process.versions.icu}. No files written.`);
}
const root = resolve(import.meta.dirname, "../..");
if (!/^nodejs 24\.20\.0\s*$/m.test(readFileSync(join(root, ".tool-versions"), "utf8"))) {
  throw new Error("Update the generator's version pins together with .tool-versions. No files written.");
}
let checking = false;
let dataDir: string | undefined;
let output = join(root, "tests/typescript/unicode");
for (const arg of process.argv.slice(2)) {
  if (arg === "--check") checking = true;
  else if (arg.startsWith("--data-dir=")) dataDir = resolve(arg.slice(11));
  else if (arg.startsWith("--output-dir=")) output = resolve(arg.slice(13));
  else throw new Error(`Unknown argument: ${arg}`);
}
const files = new Map<string, string>();
const BLOCK = 4096, LIMIT = 0x110000;
const SLICES: [number, number][] = [[0, 0x40000], [0x40000, 0x80000], [0x80000, 0xc0000], [0xc0000, LIMIT]];

const UCD_VERSION = "17.0.0";
const SOURCES = [
  { name: "PropertyValueAliases.txt", sha256: "64e9a5f76f7a1e8b5a47d6a1f9a26522a251208f5276bdfa1559dac7cf2e827a" },
  { name: "CaseFolding.txt", sha256: "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183" },
];
const inputs = new Map<string, string>();
await Promise.all(SOURCES.map(async source => {
  let bytes: Uint8Array;
  if (dataDir !== undefined) bytes = readFileSync(join(dataDir, source.name));
  else {
    const response = await fetch(`https://www.unicode.org/Public/${UCD_VERSION}/ucd/${source.name}`);
    if (!response.ok) throw new Error(`${source.name}: HTTP ${response.status}. No files written.`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== source.sha256) throw new Error(`${source.name}: SHA-256 ${actual} differs from pin. No files written.`);
  inputs.set(source.name, new TextDecoder().decode(bytes));
}));
function source(name: string): string {
  const text = inputs.get(name);
  if (text === undefined) throw new Error(`Missing verified source: ${name}`);
  return text;
}

// The canonical gc field includes aggregate categories; preserve the UCD row order.
const GENERAL_CATEGORIES: string[] = [];
for (const line of source("PropertyValueAliases.txt").split("\n")) {
  const fields = line.split("#")[0].split(";").map(field => field.trim());
  if (fields[0] !== "gc") continue;
  const name = fields[2];
  if (name === undefined || !/^[A-Za-z_]+$/.test(name) || GENERAL_CATEGORIES.includes(name)) {
    throw new Error("Malformed or duplicate General_Category value in PropertyValueAliases.txt");
  }
  GENERAL_CATEGORIES.push(name);
}

const BINARY_PROPERTIES: string[] = [
  "ASCII",
  "ASCII_Hex_Digit",
  "Alphabetic",
  "Any",
  "Assigned",
  "Bidi_Control",
  "Bidi_Mirrored",
  "Case_Ignorable",
  "Cased",
  "Changes_When_Casefolded",
  "Changes_When_Casemapped",
  "Changes_When_Lowercased",
  "Changes_When_NFKC_Casefolded",
  "Changes_When_Titlecased",
  "Changes_When_Uppercased",
  "Dash",
  "Default_Ignorable_Code_Point",
  "Deprecated",
  "Diacritic",
  "Emoji",
  "Emoji_Component",
  "Emoji_Modifier",
  "Emoji_Modifier_Base",
  "Emoji_Presentation",
  "Extended_Pictographic",
  "Extender",
  "Grapheme_Base",
  "Grapheme_Extend",
  "Hex_Digit",
  "IDS_Binary_Operator",
  "IDS_Trinary_Operator",
  "ID_Continue",
  "ID_Start",
  "Ideographic",
  "Join_Control",
  "Logical_Order_Exception",
  "Lowercase",
  "Math",
  "Noncharacter_Code_Point",
  "Pattern_Syntax",
  "Pattern_White_Space",
  "Quotation_Mark",
  "Radical",
  "Regional_Indicator",
  "Sentence_Terminal",
  "Soft_Dotted",
  "Terminal_Punctuation",
  "Unified_Ideograph",
  "Uppercase",
  "Variation_Selector",
  "White_Space",
  "XID_Continue",
  "XID_Start",
];

const STRING_PROPERTIES: string[] = [
  "Basic_Emoji",
  "Emoji_Keycap_Sequence",
  "RGI_Emoji_Modifier_Sequence",
  "RGI_Emoji_Flag_Sequence",
  "RGI_Emoji_Tag_Sequence",
  "RGI_Emoji_ZWJ_Sequence",
  "RGI_Emoji",
];

// C and S mappings are single-code-point inputs to the oracle; F and T are excluded.
const SIMPLE_FOLDS: [number, number][] = [];
for (const line of source("CaseFolding.txt").split("\n")) {
  const [from, status, to] = line.split("#")[0].split(";").map(field => field.trim());
  if (status !== "C" && status !== "S") continue;
  if (from === undefined || to === undefined || !/^[0-9A-F]{4,6}$/.test(from) || !/^[0-9A-F]{4,6}$/.test(to)) {
    throw new Error("Malformed simple/common mapping in CaseFolding.txt");
  }
  SIMPLE_FOLDS.push([parseInt(from, 16), parseInt(to, 16)]);
}

function quoted(text: string): string {
  let out = '"';
  for (let i = 0; i < text.length; i++) out += "\\u" + text.charCodeAt(i).toString(16).padStart(4, "0");
  return out + '"';
}
function hex(value: number, width = 6): string { return value.toString(16).padStart(width, "0"); }
function slug(text: string): string { return text.toLowerCase().replace(/_/g, "-"); }
function numberArray(name: string, values: number[], width = 8): string {
  let result = `const ${name}: number[] = [\n`;
  for (let i = 0; i < values.length; i += 8) {
    result += "  " + values.slice(i, i + 8).map(value => "0x" + hex(value, width)).join(", ") + ",\n";
  }
  return result + "];\n";
}
function header(description: string, kind: "exhaustive" | "sequences", extra: string[] = []): string {
  const features = ["ts-unicode-regexp", `ts-unicode-${kind}`, "ts-strings", "ts-arrays", "ts-iteration", ...extra];
  return `/*---\ndescription: ${description}\nfeatures: [${[...new Set(features)].join(", ")}]\n---*/\n` +
    `// Generated by tooling/unicode-cases/regexp.ts; Node ${NODE}, Unicode ${UNICODE}, ICU ${ICU}.\n` +
    "// Contract: docs/foundations/unicode.md, The design and Staying identical to node.\n";
}
function record(name: string, source: string): void {
  if (files.has(name)) throw new Error(`Duplicate generated name: ${name}`);
  if (/[^\x00-\x7f]/.test(source)) throw new Error(`Non-ASCII generated source: ${name}`);
  files.set(name, source);
}
function appendBit(hash: number, value: boolean): number {
  // FNV-1a over the UTF-16 code unit for ASCII "0" or "1".
  return Math.imul(hash ^ (value ? 0x31 : 0x30), 16777619) >>> 0;
}
function propertyCases(group: string, value: string, expression: string, flags: string[]): void {
  const patterns = flags.map(flag => new RegExp(`^\\p{${expression}}$`, flag));
  for (const [begin, end] of SLICES) {
    const expected: number[] = [];
    for (let block = begin; block < end; block += BLOCK) {
      let hash = 2166136261;
      for (let cp = block; cp < block + BLOCK; cp++) {
        const input = String.fromCodePoint(cp);
        for (const pattern of patterns) hash = appendBit(hash, pattern.test(input));
      }
      expected.push(hash);
    }
    const range = `${hex(begin)}-${hex(end - 1)}`;
    let text = header(`${expression} membership in ${flags.join(" and ")} over U+${hex(begin)}..U+${hex(end - 1)}.`, "exhaustive", ["ts-numbers"]);
    text += "// Each code point includes lone surrogates. Each block starts with FNV offset 2166136261.\n";
    text += `// Feed one UTF-16 '0'/'1' unit per result, in ${flags.join(", ")} order for each code point.\n`;
    for (let i = 0; i < flags.length; i++) text += `const pattern${i} = /^\\p{${expression}}$/${flags[i]};\n`;
    text += numberArray("expected", expected);
    text += `assert.sameValue(expected.length, ${(end - begin) / BLOCK});\n`;
    text += `for (let block = 0x${hex(begin)}; block < 0x${hex(end)}; block += 4096) {\n`;
    text += "  let hash = 2166136261;\n";
    text += "  for (let cp = block; cp < block + 4096; cp++) {\n    const input = String.fromCodePoint(cp);\n";
    for (let i = 0; i < flags.length; i++) text += `    hash = Math.imul(hash ^ (pattern${i}.test(input) ? 0x31 : 0x30), 16777619) >>> 0;\n`;
    text += "  }\n";
    text += `  assert.sameValue(hash, expected[(block - 0x${hex(begin)}) / 4096], "${expression} block U+" + block.toString(16));\n}\n`;
    record(`regexp-property-${group}-${slug(value)}-${range}.ts`, text);
  }
}

if (GENERAL_CATEGORIES.length !== 38 || BINARY_PROPERTIES.length !== 53 || STRING_PROPERTIES.length !== 7) {
  throw new Error("The pinned property inventory changed; re-audit the source tables before generating.");
}
for (const category of GENERAL_CATEGORIES) propertyCases("gc", category, `General_Category=${category}`, ["u", "v"]);
for (const property of BINARY_PROPERTIES) propertyCases("binary", property, property, ["u", "v"]);
for (const script of ["Latin", "Greek", "Cyrillic", "Han"]) {
  propertyCases("script", script, `Script=${script}`, ["u", "v"]);
  propertyCases("script-extensions", script, `Script_Extensions=${script}`, ["u", "v"]);
}
for (const property of STRING_PROPERTIES) propertyCases("string", property, property, ["v"]);

// Exhaustive runtime folding: candidate C/S pairs plus adjacent-code-point controls.
// All patterns are ASCII literals, so their syntax alone cannot justify dropping folding data.
// A legacy dot consumes one UTF-16 unit. The legacy sweep uses a quantified
// all-unit class to capture an entire supplementary pair; its backreference still
// compares units and cannot fold a supplementary uppercase/lowercase pair.
if (SIMPLE_FOLDS.length !== 1512 || SIMPLE_FOLDS.some(([from, to], i) =>
  from < 0 || to < 0 || from >= LIMIT || to >= LIMIT || (i > 0 && from <= SIMPLE_FOLDS[i - 1][0]))) {
  throw new Error("The pinned 1512 simple/common folding pairs changed or are unsorted.");
}
const foldU = /^([\s\S])\1$/iu, foldV = /^([\s\S])\1$/iv, foldI = /^([\s\S]+)\1$/i;
for (const [begin, end] of SLICES) {
  const pairs = SIMPLE_FOLDS.filter(([from]) => from >= begin && from < end);
  const froms = pairs.map(([from]) => from), targets = pairs.map(([, to]) => to);
  const expected: number[] = [];
  let index = 0;
  for (let block = begin; block < end; block += BLOCK) {
    let hash = 2166136261;
    for (let cp = block; cp < block + BLOCK; cp++) {
      let target = cp;
      if (index < pairs.length && froms[index] === cp) target = targets[index++];
      const original = String.fromCodePoint(cp), mapped = String.fromCodePoint(target);
      const forward = original + mapped, reverse = mapped + original;
      const neighbor = original + String.fromCodePoint((cp + 1) % LIMIT);
      for (const value of [foldU.test(forward), foldU.test(reverse), foldV.test(forward), foldV.test(reverse),
        foldI.test(forward), foldI.test(reverse), foldU.test(neighbor), foldV.test(neighbor), foldI.test(neighbor)]) {
        hash = appendBit(hash, value);
      }
    }
    expected.push(hash);
  }
  if (index !== pairs.length) throw new Error("A candidate folding pair was not visited.");
  const range = `${hex(begin)}-${hex(end - 1)}`;
  let text = header(`Runtime backreference folding over U+${hex(begin)}..U+${hex(end - 1)} under iu, iv and legacy i.`, "exhaustive", ["ts-numbers"]);
  text += "// Input pairs: Unicode 17.0.0 CaseFolding.txt C/S entries (all others compare with themselves).\n";
  text += "// Derived data copyright 2025 Unicode, Inc.; https://www.unicode.org/terms_of_use.html\n";
  text += "// Per point hash UTF-16 '0'/'1': iu forward/reverse, iv forward/reverse, i forward/reverse, then neighbor iu/iv/i.\n";
  text += "// The neighbor is cp+1, wrapping U+10FFFF to U+0000; input includes every lone surrogate.\n";
  text += "// Legacy i consumes UTF-16 units: + captures a whole pair, but comparison still cannot fold supplementary letters.\n";
  text += "const foldU = /^([\\s\\S])\\1$/iu, foldV = /^([\\s\\S])\\1$/iv, foldI = /^([\\s\\S]+)\\1$/i;\n";
  text += numberArray("froms", froms, 6) + numberArray("targets", targets, 6) + numberArray("expected", expected);
  text += `assert.sameValue(froms.length, ${pairs.length});\nassert.sameValue(targets.length, ${pairs.length});\n`;
  text += `assert.sameValue(expected.length, ${(end - begin) / BLOCK});\nlet index = 0;\n`;
  text += `for (let block = 0x${hex(begin)}; block < 0x${hex(end)}; block += 4096) {\n  let hash = 2166136261;\n`;
  text += "  for (let cp = block; cp < block + 4096; cp++) {\n    let target = cp;\n";
  text += "    if (index < froms.length && froms[index] === cp) target = targets[index++];\n";
  text += "    const original = String.fromCodePoint(cp), mapped = String.fromCodePoint(target);\n";
  text += "    const forward = original + mapped, reverse = mapped + original;\n";
  text += "    const neighbor = original + String.fromCodePoint((cp + 1) % 0x110000);\n";
  for (const expr of ["foldU.test(forward)", "foldU.test(reverse)", "foldV.test(forward)", "foldV.test(reverse)",
    "foldI.test(forward)", "foldI.test(reverse)", "foldU.test(neighbor)", "foldV.test(neighbor)", "foldI.test(neighbor)"]) {
    text += `    hash = Math.imul(hash ^ (${expr} ? 0x31 : 0x30), 16777619) >>> 0;\n`;
  }
  text += "  }\n";
  text += `  assert.sameValue(hash, expected[(block - 0x${hex(begin)}) / 4096], "backreference folding block U+" + block.toString(16));\n}\n`;
  text += "assert.sameValue(index, froms.length);\n";
  record(`regexp-fold-backreferences-${range}.ts`, text);
}

type Pattern = { source: string; flags: string };
function sequence(name: string, description: string, context: string, patterns: Pattern[], inputs: string[]): void {
  let text = header(description, "sequences", ["ts-tuples"]);
  text += `// Context: ${context}\n`;
  const compiled = patterns.map(pattern => new RegExp(pattern.source, pattern.flags));
  for (let i = 0; i < patterns.length; i++) text += `const pattern${i} = /${patterns[i].source}/${patterns[i].flags};\n`;
  text += `const samples: [string, ${patterns.map(() => "boolean").join(", ")}][] = [\n`;
  for (const input of inputs) text += `  [${quoted(input)}, ${compiled.map(pattern => pattern.test(input)).join(", ")}],\n`;
  text += "];\nfor (const sample of samples) {\n";
  for (let i = 0; i < patterns.length; i++) {
    text += `  assert.sameValue(pattern${i}.test(sample[0]), sample[${i + 1}], "${name} pattern ${i}");\n`;
  }
  text += "}\n";
  record(`regexp-sequence-${name}.ts`, text);
}
sequence("kelvin-simple-fold", "Unicode folding reaches ASCII K through the Kelvin sign; legacy i does not.",
  "a non-ASCII code point folds into ASCII only in Unicode-aware matching.",
  [{ source: "^k$", flags: "i" }, { source: "^k$", flags: "iu" }, { source: "^k$", flags: "iv" }],
  ["K", "k", "\u212a", "\u212b", "KK"]);
sequence("long-s-simple-fold", "Unicode folding reaches ASCII s through long s; legacy i does not.",
  "long s must retain the Unicode-aware simple-fold path into ASCII.",
  [{ source: "^s$", flags: "i" }, { source: "^s$", flags: "iu" }, { source: "^s$", flags: "iv" }],
  ["S", "s", "\u017f", "\u00df", "ss"]);
sequence("ohm-canonicalization", "Simple folding and legacy uppercase canonicalization differ for the Ohm sign.",
  "Greek omega and the Ohm sign have different legacy canonicalization classes.",
  [{ source: String.raw`^\u03a9$`, flags: "i" }, { source: String.raw`^\u03a9$`, flags: "iu" }, { source: String.raw`^\u03a9$`, flags: "iv" }],
  ["\u03a9", "\u03c9", "\u2126", "\u03bf"]);
sequence("sharp-s-not-full-fold", "RegExp uses simple folding and does not expand sharp s into two ASCII letters.",
  "capital sharp s shares the Unicode class while full-fold SS is still two characters.",
  [{ source: String.raw`^\u00df$`, flags: "i" }, { source: String.raw`^\u00df$`, flags: "iu" }, { source: String.raw`^\u00df$`, flags: "iv" }],
  ["\u00df", "\u1e9e", "SS", "ss", "s"]);
sequence("sigma-three-forms", "Capital sigma and both lowercase sigma forms share a RegExp case class.",
  "RegExp folding has no word-final contextual sigma mapping.",
  [{ source: String.raw`^\u03a3$`, flags: "i" }, { source: String.raw`^\u03a3$`, flags: "iu" }, { source: String.raw`^\u03a3$`, flags: "iv" }],
  ["\u03a3", "\u03c3", "\u03c2", "\u03c4", "\u0391\u03a3"]);
for (const item of [
  { name: "deseret", upper: 0x10400, lower: 0x10428 },
  { name: "osage", upper: 0x104b0, lower: 0x104d8 },
  { name: "adlam", upper: 0x1e900, lower: 0x1e922 },
]) {
  const upper = String.fromCodePoint(item.upper), lower = String.fromCodePoint(item.lower);
  const literal = upper.split("").map(unit => "\\u" + hex(unit.charCodeAt(0), 4)).join("");
  sequence(`${item.name}-supplementary-fold`, `Unicode flags fold supplementary ${item.name} letters as code points.`,
    "legacy i compares UTF-16 units while iu and iv fold the supplementary letter.",
    [{ source: `^${literal}$`, flags: "i" }, { source: `^${literal}$`, flags: "iu" }, { source: `^${literal}$`, flags: "iv" }],
    [upper, lower, upper + lower, "\ud800", "\udc00"]);
}
const paired = ["KK", "K\u212a", "\u212aK", "\u212a\u212a", "k\u212a", "\u017fs", "s\u017f", "\u03a9\u2126", "\u2126\u03a9", "\u03a3\u03c2", "KX", "SS", "\u00df\u1e9e",
  "\ud801\udc00\ud801\udc00", "\ud801\udc00\ud801\udc28", "\ud801\udc28\ud801\udc00"];
for (const flags of ["iu", "iv", "i"]) sequence(`ascii-backreference-${flags}`,
  `An ASCII-only backreference pattern retains ${flags === "i" ? "legacy canonicalization" : "simple folding"} data at runtime.`,
  "runtime capture compares K/Kelvin; legacy dot consumes one UTF-16 unit, so two supplementary letters cannot fit it.",
  [{ source: String.raw`^(.)\1$`, flags }], paired);
sequence("v-intersection", "UnicodeSets intersects ASCII membership with the Unicode Letter property.",
  "intersection keeps only characters belonging to both sets.",
  [{ source: String.raw`^[\p{ASCII}&&\p{Letter}]+$`, flags: "v" }],
  ["Az", "abc", "\u03c0", "\u212a", "A1", "", "\ud800"]);
sequence("v-subtraction", "UnicodeSets subtracts lowercase letters from the Greek Script_Extensions set.",
  "set subtraction preserves Greek uppercase letters and applicable marks, but excludes lowercase letters.",
  [{ source: String.raw`^[\p{Script_Extensions=Greek}--\p{Lowercase_Letter}]+$`, flags: "v" }],
  ["\u03a3", "\u03a9", "\u03c3", "\u03c2", "\u0342", "\u03a3\u0342", "A", ""]);
sequence("v-string-set", "UnicodeSets string disjunction matches whole listed multi-code-point strings.",
  "q string alternatives include ASCII, a decomposed accent and a regional-indicator pair.",
  [{ source: String.raw`^[\q{ab|a\u0301|\u{1f1ec}\u{1f1f7}}]$`, flags: "v" }],
  ["ab", "a\u0301", "\ud83c\uddec\ud83c\uddf7", "a", "b", "\u00e1", "\ud83c\uddec", "abc"]);
sequence("negated-property-case-order", "Complement and simple folding use different ordering under iu and iv.",
  "the complement of Lowercase_Letter distinguishes u and v case-insensitive semantics.",
  [{ source: String.raw`^\P{Lowercase_Letter}$`, flags: "iu" }, { source: String.raw`^\P{Lowercase_Letter}$`, flags: "iv" }],
  ["a", "A", "k", "\u212a", "\u017f", "1", "\u0301", "\ud800"]);
sequence("surrogate-unit-boundaries", "Unicode dot consumes a surrogate pair as one code point and preserves isolated surrogates.",
  "lone high and low surrogates differ from a valid pair when matching one character.",
  [{ source: "^.$", flags: "" }, { source: "^.$", flags: "u" }, { source: "^.$", flags: "v" }],
  ["\ud800", "\udc00", "\ud800\udc00", "\udc00\ud800", "\ud800A", "\ud83d\ude00", "A"]);
sequence("property-aliases", "RegExp accepts the exact canonical and alias spellings for Unicode properties.",
  "General_Category aliases share membership, and Script_Extensions includes shared script marks.",
  [{ source: String.raw`^\p{gc=Lu}$`, flags: "u" }, { source: String.raw`^\p{Uppercase_Letter}$`, flags: "u" },
   { source: String.raw`^\p{AHex}$`, flags: "u" }, { source: String.raw`^\p{scx=Grek}$`, flags: "v" }],
  ["A", "f", "G", "\u03a3", "\u03c3", "\u0342", "\ua7ce", "\ua7cf", "\ud800"]);
const emojiInputs = ["\ud83d\ude00", "\u2764", "\u2764\ufe0f", "1\ufe0f\u20e3", "#\ufe0f\u20e3",
  "\ud83d\udc4d\ud83c\udffd", "\ud83c\uddec\ud83c\uddf7", "\ud83c\uddff\ud83c\uddff",
  "\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc65\udb40\udc6e\udb40\udc67\udb40\udc7f",
  "\ud83d\udc69\u200d\ud83d\udcbb", "\ud83d\udc69\u200d", "\ud83c\uddec", "\ud83c\udffd", "1", "\ud800"];
for (const property of STRING_PROPERTIES) sequence(`v-${slug(property)}`,
  `${property} matches its complete Unicode emoji strings under v.`,
  `the ${property} string property sees complete emoji sequences, not arbitrary pieces of them.`,
  [{ source: `^\\p{${property}}$`, flags: "v" }], emojiInputs);

let names = header("Dynamic RegExp without flags validates Unicode group names, including a Unicode 17 letter.", "sequences", ["ts-errors"]);
names += "// Context: dynamic named-group parsing needs identifier data even without i, u or v.\n";
const groupNames = ["\u03c0", "\ua7ce", "\ud801\udc00", "\u03c0\u200d", "\u03c0\u200c", "\u03c0\u0301"];
names += `const names: string[] = [${groupNames.map(quoted).join(", ")}];\n`;
for (const name of groupNames) {
  const pattern = new RegExp(`^(?<${name}>x)\\k<${name}>$`);
  const match = pattern.exec("xx");
  if (match === null || match.groups === undefined || match.groups[name] !== "x") throw new Error("Unexpected named-group oracle");
}
names += "for (const name of names) {\n";
names += '  const pattern = new RegExp("^(?<" + name + ">x)\\\\k<" + name + ">$");\n';
names += `  assert.sameValue(pattern.flags, "");\n  const match = pattern.exec(${quoted("xx")});\n`;
names += '  if (match === null || match.groups === undefined) throw new Test262Error("missing named group");\n';
names += `  assert.sameValue(match[0], ${quoted("xx")});\n  assert.sameValue(match[0].length, 2);\n`;
names += `  assert.sameValue(match.groups[name], ${quoted("x")});\n  assert.sameValue(match.groups[name].length, 1);\n}\n`;
record("regexp-sequence-dynamic-unicode-group-names.ts", names);
let rejected = header("Dynamic RegExp rejects invalid Unicode group-name starts without relying on Unicode flags.", "sequences", ["ts-errors"]);
rejected += "// Context: a digit, combining mark, lone surrogate or join control cannot start a capture name.\n";
const badNames = ["1", "\u0301", "\ud800", "\udc00", "\u200c", "\u200d"];
for (const name of badNames) {
  let syntax = false;
  try { new RegExp(`(?<${name}>x)`); } catch (error) { if (!(error instanceof SyntaxError)) throw error; syntax = true; }
  if (!syntax) throw new Error("Unexpected accepted capture name");
}
rejected += `for (const name of [${badNames.map(quoted).join(", ")}]) {\n`;
rejected += '  assert.throws(SyntaxError, () => new RegExp("(?<" + name + ">x)"));\n}\n';
record("regexp-sequence-dynamic-invalid-group-names.ts", rejected);

const stale = existsSync(output) ? readdirSync(output).filter(name => name.startsWith("regexp-") && name.endsWith(".ts") && !files.has(name)) : [];
if (stale.length > 0) throw new Error(`Unexpected RegExp files; review them instead of deleting automatically: ${stale.join(", ")}`);
if (checking) {
  const differences: string[] = [];
  for (const [name, content] of files) {
    const path = join(output, name);
    if (!existsSync(path) || readFileSync(path, "utf8") !== content) differences.push(name);
  }
  if (differences.length > 0) throw new Error(`Generated cases differ: ${differences.join(", ")}`);
  console.log(`Checked ${files.size} RegExp cases: Node ${NODE}, Unicode ${UNICODE}, ICU ${ICU}.`);
} else {
  mkdirSync(output, { recursive: true });
  for (const [name, content] of files) writeFileSync(join(output, name), content);
  console.log(`Generated ${files.size} RegExp cases: Node ${NODE}, Unicode ${UNICODE}, ICU ${ICU}.`);
}
