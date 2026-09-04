// `deprecate`, from node v24.20.0 `lib/internal/util.js`.
//
// Here rather than in `node:util` because more than one module needs it and
// `util` is not the natural dependency of any of them -- `async_hooks` reaching
// for the module that owns `inspect` in order to print one warning would make
// the two depend on each other for no reason node's own layering has.
// `node:util` re-exports this as its public `deprecate`.

import { ERR_INVALID_ARG_TYPE } from "./errors.ts";
import { emitWarning } from "./process-warning.ts";

/**
 * Wrap `fn` so that calling it warns once.
 *
 * Once, not every call: a deprecation that prints on every invocation of a
 * function in a loop is noise that hides everything else.
 */
export function deprecate<This, Args extends unknown[], Result>(
  fn: (this: This, ...args: Args) => Result,
  message: string,
  code?: string,
): (this: This, ...args: Args) => Result {
  if (code !== undefined && typeof code !== "string") {
    throw new ERR_INVALID_ARG_TYPE("code", "string", code);
  }
  let warned = false;
  return function deprecated(this: This, ...args: Args): Result {
    if (!warned) {
      warned = true;
      emitWarning(message, "DeprecationWarning", code ?? "");
    }
    return fn.apply(this, args);
  };
}
