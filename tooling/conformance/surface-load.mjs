// Loading a module's two surfaces the way the harness does, for instruments that
// difference them.
//
// Three instruments now compare our published surface against node's --
// `identity-partition.mjs`, `name-arity-diff.mjs` and `descriptor-diff.mjs` --
// and each needs the same two things: node's builtin, and ours built the way
// `run-one.mjs` builds it. The preamble is not obvious and getting it wrong does
// not look like an instrument bug:
//
//   - `bindings.node.mjs` must be imported *before* `src/main.ts`, or the module
//     fails on `nts_process_env_has is not defined`, which reads as a defect in
//     the module;
//   - a `globals` file declares canonical web-platform globals to install, and
//     they live at `runtime/web-platform/`, not at the repo root -- resolving
//     that against the wrong base reported `events` and `util` as absent from a
//     tree that has them.
//
// Both cost a wrong conclusion once. Kept in one place so a fix reaches every
// caller.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../..");
const require = createRequire(import.meta.url);

/** Node's builtin, or `{ absent }` with the reason. */
export function loadNode(moduleName) {
  try {
    return { surface: require(`node:${moduleName}`) };
  } catch (error) {
    return { absent: `node has no such builtin (${error.code ?? "?"})` };
  }
}

/** Ours, through `shape.mjs`, or `{ absent }` with the reason. */
export async function loadOurs(moduleName) {
  try {
    const dir = join(ROOT, "runtime/node", moduleName);
    const main = join(dir, "src/main.ts");
    if (!existsSync(main)) return { absent: "no src/main.ts" };

    const shims = join(dir, "bindings.node.mjs");
    if (existsSync(shims)) await import(shims);

    const globalsPath = join(dir, "globals");
    if (existsSync(globalsPath)) {
      const wanted = readFileSync(globalsPath, "utf8").split("\n")
        .map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
      for (const name of wanted) {
        if (name === "abort") {
          const abort = await import(join(ROOT, "runtime/web-platform/src/core/abort.ts"));
          globalThis.AbortController = abort.AbortController;
          globalThis.AbortSignal = abort.AbortSignal;
        } else if (name === "encoding") {
          const encoding = await import(join(ROOT, "runtime/web-platform/src/core/encoding.ts"));
          globalThis.TextEncoder = encoding.TextEncoder;
          globalThis.TextDecoder = encoding.TextDecoder;
        }
      }
    }

    const exports = await import(main);
    const shapePath = join(dir, "shape.mjs");
    const input = { ...exports };
    const surface = existsSync(shapePath)
      ? (await import(shapePath)).shape(input)
      : input;
    return { surface };
  } catch (error) {
    return { absent: `ours would not load: ${String(error.message).split("\n")[0].slice(0, 90)}` };
  }
}

/**
 * Own enumerable paths to `depth`, holding only values with identity.
 *
 * Each entry carries the parent and key as well as the value, so a caller can ask
 * about the *property* -- its descriptor -- and not only about what it holds.
 */
export function paths(root, depth) {
  const out = new Map();
  const walk = (value, prefix, level) => {
    let keys;
    try {
      keys = Object.keys(value);
    } catch {
      return;
    }
    for (const key of keys) {
      let child;
      try {
        child = value[key];
      } catch {
        // A throwing getter has no value to compare. It is not dropped silently:
        // it simply cannot answer, and callers count what they could not run.
        continue;
      }
      const hasIdentity = typeof child === "function" ||
        (typeof child === "object" && child !== null);
      if (!hasIdentity) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      out.set(path, { value: child, parent: value, key });
      if (level < depth) walk(child, path, level + 1);
    }
  };
  walk(root, "", 1);
  return out;
}
