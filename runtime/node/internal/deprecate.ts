// `deprecate`, from node v24.20.0 `lib/internal/util.js`.
//
// Here rather than in `node:util` because more than one module needs it and
// `util` is not the natural dependency of any of them -- `async_hooks` reaching
// for the module that owns `inspect` in order to print one warning would make
// the two depend on each other for no reason node's own layering has.
// `node:util` re-exports this as its public `deprecate`.

import { ERR_INVALID_ARG_TYPE } from "./errors.ts";

declare function nts_process_emit_warning(
  message: string,
  name: string,
  code: string,
): void;

/**
 * Wrap `fn` so that calling it warns once.
 *
 * Once, not every call: a deprecation that prints on every invocation of a
 * function in a loop is noise that hides everything else.
 */
export function deprecate<T extends (...args: never[]) => unknown>(
  fn: T,
  message: string,
  code?: string,
): T {
  if (code !== undefined && typeof code !== "string") {
    throw new ERR_INVALID_ARG_TYPE("code", "string", code);
  }
  let warned = false;
  const deprecated = function (this: unknown, ...args: never[]): unknown {
    if (!warned) {
      warned = true;
      nts_process_emit_warning(message, "DeprecationWarning", code ?? "");
    }
    return Reflect.apply(fn, this, args);
  };
  Object.defineProperty(deprecated, "name", { value: fn.name });
  return deprecated as unknown as T;
}
