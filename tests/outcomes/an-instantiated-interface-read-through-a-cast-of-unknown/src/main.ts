// **A value of one instantiation of a generic interface, read through
// another after a cast from `unknown`, read the wrong memory.** `Lazy<string>`
// and `Lazy<unknown>` lay `payload` out differently -- a string pointer
// against an erased value -- and `resolve` reads a `Lazy<string>` literal
// through `Lazy<unknown>`. A read through an interface whose owners disagree
// is a family's accessor, which dispatches to each owner's own storage; but a
// family was keyed only by a *declared* interface, and `Lazy<unknown>` is an
// instantiation of one, so the read was `Lazy<unknown>`'s offset on the
// literal and the program crashed.
//
// Instantiations of a declared interface are faces too now
// (`Hierarchy::face_instances`).
//
// **Control**: `resolveDeclared`, the same two shapes as two declared
// interfaces, `DeclaredU` and `DeclaredS`, which always dispatched.
interface Lazy<P> {
  readonly tag: number;
  readonly payload: P;
  readonly init: (payload: unknown) => unknown;
}

function resolve(lazy: Lazy<unknown>): unknown {
  const payload = lazy.payload;
  const init = lazy.init;
  return init(payload);
}

export function render(type: unknown): string {
  if (typeof type === "object" && type !== null && "init" in type) {
    return String(resolve(type as Lazy<unknown>));
  }
  return "plain";
}

interface DeclaredU {
  readonly tag: number;
  readonly payload: unknown;
  readonly init: (payload: unknown) => unknown;
}

interface DeclaredS {
  readonly tag: number;
  readonly payload: string;
  readonly init: (payload: unknown) => unknown;
}

function resolveDeclared(lazy: DeclaredU): unknown {
  const payload = lazy.payload;
  const init = lazy.init;
  return init(payload);
}

export function renderDeclared(type: unknown): string {
  if (typeof type === "object" && type !== null && "init" in type) {
    return String(resolveDeclared(type as DeclaredU));
  }
  return "plain";
}

export const label = (text: unknown): unknown => "[" + String(text) + "]";

const lazy: Lazy<string> = { tag: 1, payload: "lazy", init: label };
const declared: DeclaredS = { tag: 2, payload: "declared", init: label };
observe("an instantiation read through another", render(lazy));
observe("not a lazy value", render(42));
observe("the control, two declared interfaces", renderDeclared(declared));
done();
