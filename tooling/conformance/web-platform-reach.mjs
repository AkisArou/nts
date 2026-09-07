// Which `runtime/node` modules reach `runtime/web-platform` source, and how.
//
//   node tooling/conformance/web-platform-reach.mjs
//   node tooling/conformance/web-platform-reach.mjs core/events.ts core/abort.ts
//
// The web-platform lane pings this one when it changes `core/` or `provider/`,
// and the first thing that has to be answered is which modules could possibly
// care. That answer has been given wrong twice, both times by grepping
// `runtime/node` for the string `web-platform` and reading the direct hits as
// the whole set:
//
//   - `readline` was missed, because it reaches `core/events.ts` through
//     `util/src/main.ts` rather than directly;
//   - `fs` was missed, because it imports from `streams/readable.ts` and the
//     grep was for `core/`.
//
// Both are the same mistake: searching for the shape of the expected answer.
// This follows imports instead, transitively and within `runtime/node`, so the
// set is computed rather than remembered. Given file arguments it reports only
// the modules reaching those files, which is the form the ping actually needs.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const NODE_ROOT = join(ROOT, "runtime/node");

const wanted = process.argv.slice(2);

/** Every `from "..."` and `import("...")` specifier in a file. */
function specifiers(file) {
  const source = readFileSync(file, "utf8");
  const out = [];
  for (const m of source.matchAll(/from\s+["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

function tsFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "test") continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir);
  return out;
}

/**
 * Every web-platform file reachable from `start`, with one example path to each.
 * Breadth-first so the reported path is a shortest one, which is what makes
 * "through `util/src/main.ts`" readable rather than a chain of six.
 */
function reach(start) {
  const found = new Map();
  const seen = new Set();
  const queue = tsFiles(start).map((f) => [f, [f]]);
  for (const [f] of queue) seen.add(f);

  while (queue.length > 0) {
    const [file, path] = queue.shift();
    for (const spec of specifiers(file)) {
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(file), spec);
      if (!existsSync(target)) continue;
      const rel = relative(ROOT, target);
      if (rel.startsWith("runtime/web-platform")) {
        if (!found.has(rel)) found.set(rel, path.map((p) => relative(ROOT, p)));
        continue;
      }
      if (!rel.startsWith("runtime/node") || seen.has(target)) continue;
      seen.add(target);
      queue.push([target, [...path, target]]);
    }
  }
  return found;
}

const modules = readdirSync(NODE_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "node_modules" && e.name !== "internal")
  .map((e) => e.name)
  .sort();

let any = 0;
for (const module of modules) {
  const found = reach(join(NODE_ROOT, module, "src"));
  const hits = [...found.entries()].filter(
    ([rel]) => wanted.length === 0 || wanted.some((w) => rel.endsWith(w)),
  );
  if (hits.length === 0) continue;
  any++;
  console.log(`  ${module}`);
  for (const [rel, path] of hits.sort()) {
    // Only the hops that are not the module's own first file, since "it starts
    // in its own source" is not information.
    const via = path.slice(1);
    const suffix = via.length > 0 ? `   via ${via.join(" -> ")}` : "";
    console.log(`      ${rel.replace("runtime/web-platform/src/", "")}${suffix}`);
  }
}

console.log(
  `\n  ${any} of ${modules.length} module(s) reach ${
    wanted.length === 0 ? "runtime/web-platform" : wanted.join(", ")
  }`,
);
