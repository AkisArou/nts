// expect: NTS1003 `renderStatus` cannot be compiled because it calls `renderWith`, which this program compiles only as instantiations
//
// **A generic function called with `null` for its type-parameter arguments
// is refused through a cascade with no root.** `renderWith<P, S>` is called
// twice: from `renderLabelled` with an object and a number, which compiles,
// and from `renderStatus` with `null` and `null`, so `P` and `S` are `null`.
// No copy is made for that call and nothing says why: `renderStatus` is
// refused because `renderWith` "compiles only as instantiations
// (renderWith<objN,f64>)", there is no NTS1001 beneath it, and integrity's
// cascade-has-root rule reports `renderWith` as blamed with no refusal of its
// own. The program prints nothing; node prints `a1 pending`.
//
// **What the missing root is**, from a variant, measured and not kept here:
// give `Status` the parameters the call implies, `(props: null, second:
// null)`, and the refusal appears where it belongs -- "a parameter of
// unrepresentable type (null)". So the copy `renderWith<null, null>` is
// refused for a `null`-typed parameter, and that refusal is not recorded.
// Writing the type arguments out, `renderWith<null, null>(...)`, changes
// nothing.
//
// **Control**, measured and not kept in this file: the same call with
// `undefined, undefined`, a one-line difference. It compiles with nothing
// refused and prints node's line, as does `"x", "y"`.
//
// **Measured the same** on 2e8eedb17, 80615a9aa, da4a2a4a8, efc71ad44 and
// bcf750d4b.
//
// **Found by the React lane.** ReactFiberHooks.ts:861 is this call:
// `renderTransitionAwareHostComponentWithHooks` calls
// `renderWithHooks(current, workInProgress, TransitionAwareHostComponent,
// null, null, lanes)`, whose `Props` and `SecondArg` are then `null`, while
// beginWork's other two calls instantiate it with a props record. With the
// LazyComponent, `Array.isArray`, component-name and readContext roots stood
// in for (scratch only), it is where the GTK counter's chain from `main`
// stops: beginWork -> updateHostComponent -> this. Its `@raises` copy's
// cascade names no cause at all ("calls `renderWithHooks@raises`, which
// nothing in this program defines").
type Render<P, S> = (props: P, second: S) => unknown;

function renderWith<P, S>(component: Render<P, S>, props: P, second: S): unknown {
  return component(props, second);
}

function Labelled(props: { label: string }, second: number): string {
  return props.label + String(second);
}

function Status(): string {
  return "pending";
}

function renderLabelled(): string {
  return renderWith(Labelled, { label: "a" }, 1) as string;
}

function renderStatus(): string {
  return renderWith(Status, null, null) as string;
}

console.log(renderLabelled() + " " + renderStatus());
