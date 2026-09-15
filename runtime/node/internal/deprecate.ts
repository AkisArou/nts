// `deprecate`, from node v24.20.0 `lib/internal/util.js`.
//
// Here rather than in `node:util` so that a module needing one deprecation
// warning does not have to depend on the module that owns `inspect`, which is
// not the natural dependency of any of them and which node's own layering does
// not have either. `node:util` re-exports this as its public `deprecate`.
//
// Today `util/src/main.ts` is the only importer. The first version of this
// comment said "more than one module needs it" and named `async_hooks`, which
// turned out to describe an intention rather than the tree -- `async_hooks`
// mentions the word in prose and imports nothing. Kept here regardless, because
// the layering argument is the reason and it does not depend on the count.

import { ERR_INVALID_ARG_TYPE } from "./errors.ts";
import { emitWarning } from "./process-warning.ts";

/** Node emits a coded deprecation once per process, not once per wrapper. */
const warnedCodes = new Set<string>();

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
  function deprecated(this: This, ...args: Args): Result {
    if (!warned) {
      warned = true;
      if (code === undefined) {
        emitWarning(message, "DeprecationWarning", "");
      } else if (!warnedCodes.has(code)) {
        warnedCodes.add(code);
        emitWarning(message, "DeprecationWarning", code);
      }
    }
    // `new.target`, because the wrapper has to stay constructible. `fn.apply`
    // does not construct: against a `class` it throws outright -- "Class
    // constructor K cannot be invoked without 'new'" -- and against an ordinary
    // constructor function it happens to work only because `this` is already the
    // new object and the body assigns to it. Node uses `Reflect.construct` and
    // forwards `new.target`, so a subclass of the wrapper gets its own prototype.
    const target = new.target as unknown as (new (...args: Args) => Result) | undefined;
    if (target !== undefined) {
      return Reflect.construct(fn as unknown as new (...args: Args) => Result, args, target);
    }
    return fn.apply(this, args);
  }

  // The three things node copies onto the wrapper, each of which is observable
  // and none of which a plain closure has. Without them the wrapper reported
  // `length` 0 for a two-parameter function, did not have `fn` in its prototype
  // chain, and lost `fn.prototype` entirely, so `new Wrapped(1) instanceof fn`
  // was false.
  //
  // Node's comment on the prototype pair is worth keeping: it sets `prototype`
  // directly rather than through the chain "so that calling the unwrapped
  // constructor gives an instanceof the wrapped constructor".
  Object.setPrototypeOf(deprecated, fn);
  const prototype = (fn as { prototype?: unknown }).prototype;
  if (prototype) {
    (deprecated as unknown as { prototype?: unknown }).prototype = prototype;
  }
  const length = Object.getOwnPropertyDescriptor(fn, "length");
  if (length !== undefined) {
    Object.defineProperty(deprecated, "length", length);
  }
  return deprecated;
}
