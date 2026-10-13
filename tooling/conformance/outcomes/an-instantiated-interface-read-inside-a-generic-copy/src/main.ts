// **The same read inside a generic function.** `resolve<T>(lazy: Lazy<T,
// unknown>)` reads `lazy.payload`, and the checker types that receiver as the
// open `Lazy<T, unknown>`, which no value ever has: the copy made for
// `T = unknown` holds `Lazy<unknown, unknown>`. Keying the read by the open
// form found no family even once instantiations were faces, so the read was
// an offset on a `Lazy<string, string>` literal and the program crashed.
//
// A site in a generic body names each instance its copies make of it
// (`Hierarchy::template_instances`), and a copy's read takes its own.
//
// **Control**: `resolvePlain`, the same body written for
// `Lazy<unknown, unknown>` with no type parameter -- the case
// `an-instantiated-interface-read-through-a-cast-of-unknown` guards.
interface Lazy<T, P> {
  readonly tag: number;
  readonly payload: P;
  readonly init: (payload: unknown) => unknown;
  readonly value?: T;
}

function resolve<T>(lazy: Lazy<T, unknown>): unknown {
  const payload = lazy.payload;
  const init = lazy.init;
  return init(payload);
}

function resolvePlain(lazy: Lazy<unknown, unknown>): unknown {
  const payload = lazy.payload;
  const init = lazy.init;
  return init(payload);
}

export function render(type: unknown, generic: boolean): string {
  if (typeof type === "object" && type !== null && "init" in type) {
    const lazy = type as Lazy<unknown, unknown>;
    return String(generic ? resolve(lazy) : resolvePlain(lazy));
  }
  return "plain";
}

export const label = (text: unknown): unknown => "[" + String(text) + "]";

const lazy: Lazy<string, string> = { tag: 1, payload: "lazy", init: label };
observe("read inside a generic copy", render(lazy, true));
observe("not a lazy value", render(42, true));
observe("the control, no type parameter", render(lazy, false));
done();
