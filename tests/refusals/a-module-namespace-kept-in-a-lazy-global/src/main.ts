// expect: a namespace is not supported by this lowering yet
// ZIP's former lazy facade stored and returned the parent module namespace.
// Control: a-module-facade-called-through-live-imports calls the same export
// through a live binding, without turning the namespace into a runtime value.
import * as facade from "./facade.ts";

let cached: typeof facade | undefined;

function lazyFacade(): typeof facade {
  cached ??= facade;
  return cached;
}

export function throughFacade(n: number): number {
  return lazyFacade().value(n);
}
