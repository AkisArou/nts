// Which root constructs stand between a module and its exports.
//
//   node tooling/conformance/last-mile.mjs string_decoder
//   NTS_BIN=<a pinned copy> node tooling/conformance/last-mile.mjs --all
//
// `blockers.mjs` answers "what does this module's cone refuse", which is a
// count over the cone. This answers a narrower question: **for each function
// this module's own source cannot compile, which single construct is at the end
// of the chain.** That is the unit of work -- three chains means three things
// have to land, and a cone of sixty-five constructs can still be three chains.
//
// The walk is: every NTS1003 in the module's own source names a callee; find
// that callee's declaration and its line range in whatever file it lives in;
// report the NTS1001 that falls *inside* that range; if the callee is itself
// NTS1003, follow it. Repeat until a root or a cycle.
//
// **Ranges, not proximity.** `blockers.mjs` deliberately refuses to attribute a
// construct to an enclosing function, because "the diagnostic gives a location
// and not an enclosing name" and guessing by nearest line is a guess wearing a
// number. A range is not a guess: a line either falls inside a declaration's
// extent or it does not. `string_decoder` is the case that proves the
// difference -- `Buffer#toString` names `decodeIn`, every NTS1003 mentioning it
// sits in `buffer/src/main.ts`, and `decodeIn` is declared in `encodings.ts`.
// Proximity would have blamed whatever was nearest in the wrong file.
//
// A callee whose range cannot be found is printed as UNRESOLVED rather than
// guessed at, because silence would read as "no blocker".

import { readFileSync, existsSync, readdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const compiler = process.env.NTS_BIN ?? process.env.NTS_COMPILER ??
  join(ROOT, "target/release/nts");

const argv = process.argv.slice(2);
const all = argv.includes("--all");
const modules = all
  ? readdirSync(join(ROOT, "runtime/node")).filter((m) =>
    m !== "node_modules" && existsSync(join(ROOT, "runtime/node", m, "tsconfig.json")))
  : argv.filter((a) => !a.startsWith("--"));

if (modules.length === 0) {
  console.error("usage: last-mile.mjs <module> | --all");
  process.exit(2);
}

/** Every NTS1001 root and NTS1003 cascade the module's cone reports. */
function refusals(module) {
  const out = mkdtempSync(join(tmpdir(), `nts-lastmile-${module}-`));
  const run = spawnSync(
    compiler,
    ["emit-c", join(ROOT, "runtime/node", module, "tsconfig.json"), "--out", out, "--napi"],
    { encoding: "utf8", env: { ...process.env, NTS_TSGO: join(ROOT, "target/tsgo") } },
  );
  const text = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const roots = [];
  const cascades = [];
  const declines = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("no wrapper for")) {
      declines.push(line);
      continue;
    }
    const root = /^(.*?):(\d+):(\d+): NTS1001 (.*?) is not supported by this lowering yet$/.exec(line);
    if (root !== null) {
      roots.push({ file: root[1], line: Number(root[2]), message: root[4] });
      continue;
    }
    const cascade = /^(.*?):(\d+):(\d+): NTS1003 `(.*?)` cannot be compiled because it (?:calls|reads) `(.*?)`/.exec(line);
    if (cascade !== null) {
      cascades.push({ file: cascade[1], line: Number(cascade[2]), subject: cascade[4], callee: cascade[5] });
    }
  }
  return { roots, cascades, declines };
}

const rangeCache = new Map();

/**
 * The line range of a named declaration, searched across the files that
 * refused. `Class#member` and `Class.member` look for the member inside that
 * class; a bare name is searched at any depth.
 */
function rangeOf(name, files) {
  const key = `${name}::${files.length}`;
  const cached = rangeCache.get(key);
  if (cached !== undefined) return cached;

  const hash = name.indexOf("#");
  const dot = name.indexOf(".");
  const owner = hash >= 0 ? name.slice(0, hash) : (dot >= 0 ? name.slice(0, dot) : null);
  const bare = hash >= 0 ? name.slice(hash + 1) : (dot >= 0 ? name.slice(dot + 1) : name);

  // `static override from<T>(`, `override toString(`, `async #drain(` -- the
  // modifiers are in no fixed order in the profile, so they are matched as a
  // set rather than a sequence.
  const mods = "(?:static|override|async|readonly|public|private|protected|get|set)\\s+";
  const patterns = [
    new RegExp(`^(export\\s+)?(default\\s+)?(async\\s+)?function\\s+${bare}\\b`),
    new RegExp(`^(export\\s+)?(const|let|var)\\s+${bare}\\b`),
    new RegExp(`^\\s*(${mods})*#?${bare}\\s*[(<]`),
    new RegExp(`^\\s*(${mods})*#?${bare}\\s*=`),
  ];
  const classHead = owner === null
    ? null
    : new RegExp(`^(export\\s+)?(abstract\\s+)?class\\s+${owner}\\b`);

  /** Where a declaration starting at `i` ends: the first line closing at its indent. */
  function extent(lines, i) {
    const text = lines[i];
    const indent = text.length - text.trimStart().length;
    const closer = `${" ".repeat(indent)}}`;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trimEnd();
      if (t === closer || t === `${closer};`) return j + 1;
    }
    return lines.length;
  }

  // A member is searched only inside its owner's extent. Scanning the whole
  // file with a sticky "we are in the class now" flag is what made the first
  // version blame `Buffer.from` for four BigInt refusals 800 lines below the
  // class -- the flag never turned off, and the smallest matching range won.
  for (const file of files) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    const windows = [];
    if (classHead === null) {
      windows.push([0, lines.length]);
    } else {
      for (let i = 0; i < lines.length; i++) {
        if (classHead.test(lines[i])) windows.push([i + 1, extent(lines, i)]);
      }
    }
    for (const [from, to] of windows) {
      for (let i = from; i < to && i < lines.length; i++) {
        if (!patterns.some((p) => p.test(lines[i]))) continue;
        // An overload signature has no body. `static from(v: string): Buffer;`
        // matches the same pattern as the implementation, and measuring its
        // extent runs past it to the next closing brace at that indent -- which
        // is how `Buffer.from` came to be blamed for four BigInt refusals 800
        // lines away. Only a declaration that opens a body counts, and the
        // signature may span lines: `Buffer.from`'s runs 413..417 before its
        // `;`, and the implementation's runs 423..427 before its `{`.
        let opens = false;
        for (let k = i; k < Math.min(i + 40, to, lines.length); k++) {
          const t = lines[k].trimEnd();
          if (t.endsWith("{")) { opens = true; break; }
          if (t.endsWith(";")) { opens = false; break; }
        }
        if (!opens) continue;
        const range = { file, start: i + 1, end: extent(lines, i) };
        rangeCache.set(key, range);
        return range;
      }
    }
  }
  rangeCache.set(key, null);
  return null;
}

for (const module of modules) {
  const own = join(ROOT, "runtime/node", module, "src");
  const { roots, cascades, declines } = refusals(module);
  const files = [...new Set([...roots, ...cascades].map((r) => r.file))];
  const mine = cascades.filter((c) => c.file.startsWith(own));
  const callees = [...new Set(mine.map((c) => c.callee))];
  const ownRoots = roots.filter((r) => r.file.startsWith(own));

  console.log(`\n${module}: ${ownRoots.length} own root(s), ${mine.length} cascade(s) naming ${callees.length} callee(s)`);
  for (const r of ownRoots) {
    console.log(`  ROOT (own)  ${r.file.replace(`${ROOT}/`, "")}:${r.line}  ${r.message}`);
  }

  const chains = new Map();
  const unresolved = [];
  for (const callee of callees) {
    let name = callee;
    const seen = new Set();
    for (let hop = 0; hop < 12; hop++) {
      if (seen.has(name)) break;
      seen.add(name);
      const range = rangeOf(name, files);
      if (range === null) {
        unresolved.push(`${callee} (stopped at ${name})`);
        break;
      }
      const inside = roots.filter((r) =>
        r.file === range.file && r.line >= range.start && r.line <= range.end);
      for (const r of inside) chains.set(`${r.file}:${r.line}`, r.message);

      // A function can carry a root of its own *and* call something refused.
      // `Buffer#toString` does both: `end = this.length` in its parameter list
      // is one construct, and `decodeIn` is a second chain behind it. Stopping
      // at the first root reported three of this module's four.
      const next = cascades.find((c) => c.subject === name);
      if (next === undefined) {
        if (inside.length === 0) {
          unresolved.push(`${callee} (stopped at ${name}: no root inside it and no onward call)`);
        }
        break;
      }
      name = next.callee;
    }
  }

  console.log(`  => ${chains.size} distinct root construct(s) reached through this module's own source`);
  for (const [where, what] of chains) {
    console.log(`     ${where.replace(`${ROOT}/`, "")}  ${what}`);
  }
  for (const u of unresolved) console.log(`     UNRESOLVED ${u}`);
  if (declines.length > 0) console.log(`  wrapper: ${declines.length} decline(s)`);
}
