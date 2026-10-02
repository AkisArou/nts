// node's half of a pinned-outcome run: print an uncaught exception the way a
// compiled nts program does, so the two runs compare as text.
//
//   nts:   nts: uncaught <Class>: <message>      exit 1
//   node:  nts: uncaught <Class>: <message>      exit 1   (this file)
//
// The class is the constructor's name, as nts reads it from the descriptor; a
// thrown non-object has none and prints as its String(), which nts cannot
// produce and which therefore shows up as a difference rather than hiding.
// A rejection nobody handles is reported the same way: nts ends an `async`
// function's uncaught throw as `nts: uncaught <Class>`, and node would otherwise
// print its own UnhandledPromiseRejection text -- so a fixture reporting from
// inside an `async` function disagreed with itself about the harness, not the
// program. (Found probing a rethrow through `await`.)
// `@nts/runtime/<path>` resolves to `runtime/<path>`, as the tsconfig
// outcomes-project.ts writes resolves it for nts: one definition, both sides.
//
// **And a runtime module's native half is its stand-in.** A module declares
// its bindings (`declare function nts_promise_hook_install(...)`) and the
// compiled program links them; under node they are `bindings.node.mjs`, which
// the interpreted lane imports before a module's `src/main.ts` (run-one.mjs).
// A fixture can reach runtime code through any module, so the rule here is
// the general one: every runtime `.ts` file node loads is given, as its first
// import, its module's `bindings.node.mjs` when there is one. Imports
// evaluate first, so the stand-ins are installed before any body reads them.
// Without it a fixture importing `async_hooks` failed under node with
// `nts_promise_hook_install is not defined` -- a limit of this harness read as
// a fact about the program.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RUNTIME_ROOT, RUNTIME_SPECIFIER } from "./outcomes-project.ts";

/** The stand-in file for the runtime module a path belongs to, or null. */
export function bindingsFor(path) {
  const inside = relative(RUNTIME_ROOT, path).split(sep);
  // runtime/node/<module>/..., runtime/web-platform/...
  const depth = inside[0] === "node" ? 2 : 1;
  if (inside[0] === ".." || inside.length <= depth) return null;
  const file = join(RUNTIME_ROOT, ...inside.slice(0, depth), "bindings.node.mjs");
  return existsSync(file) ? file : null;
}

registerHooks({
  resolve(specifier, context, next) {
    return specifier.startsWith(RUNTIME_SPECIFIER)
      ? next(pathToFileURL(join(RUNTIME_ROOT, specifier.slice(RUNTIME_SPECIFIER.length))).href, context)
      : next(specifier, context);
  },
  load(url, context, next) {
    const loaded = next(url, context);
    if (!url.startsWith("file:") || !url.endsWith(".ts")) return loaded;
    const bindings = bindingsFor(fileURLToPath(url));
    if (!bindings) return loaded;
    const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
    return { ...loaded, source: `import ${JSON.stringify(pathToFileURL(bindings).href)};\n${source}` };
  },
});

const report = (error) => {
  // **Of an object only.** A primitive has a constructor too -- `"x".constructor`
  // is `String`, through the wrapper a property read makes -- so asking every
  // value printed a rejected string as `String: ` and dropped its text, where nts
  // prints the string. The paragraph above said a non-object prints as its
  // String(); the code did not ask whether it had one.
  // (Found by `a-rejection-passed-through-a-then-is-reported`.)
  const name = (typeof error === "object" && error !== null) || typeof error === "function"
    ? error.constructor?.name
    : undefined;
  const message = error?.message;
  process.stderr.write(
    name === undefined ? `nts: uncaught ${String(error)}\n` : `nts: uncaught ${name}: ${message ?? ""}\n`,
  );
  process.exit(1);
};
process.on("uncaughtException", report);
process.on("unhandledRejection", report);
