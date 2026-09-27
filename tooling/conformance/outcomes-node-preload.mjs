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
// outcomes-project.mjs writes resolves it for nts: one definition, both sides.
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RUNTIME_ROOT, RUNTIME_SPECIFIER } from "./outcomes-project.mjs";

registerHooks({
  resolve(specifier, context, next) {
    return specifier.startsWith(RUNTIME_SPECIFIER)
      ? next(pathToFileURL(join(RUNTIME_ROOT, specifier.slice(RUNTIME_SPECIFIER.length))).href, context)
      : next(specifier, context);
  },
});

const report = (error) => {
  const name = error?.constructor?.name;
  const message = error?.message;
  process.stderr.write(
    name === undefined ? `nts: uncaught ${String(error)}\n` : `nts: uncaught ${name}: ${message ?? ""}\n`,
  );
  process.exit(1);
};
process.on("uncaughtException", report);
process.on("unhandledRejection", report);
