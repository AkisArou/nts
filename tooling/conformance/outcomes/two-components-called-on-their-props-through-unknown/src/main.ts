// **Ours, not upstream's.** React's component call with two components, so
// the call cannot be devirtualised to one: a fiber keeps its component and
// its props as `unknown`, and rendering calls the one on the other through a
// generic function type. `a-component-called-on-its-props-through-unknown`
// is the one-component program, which is invalid HIR instead.
//
// **Expected, confirmed under node:**
//
//     first    3
//     second   b:4
type Render<P> = (props: P) => string;
interface Fiber {
  type: unknown;
  props: unknown;
}
function render(fiber: Fiber): string {
  return (fiber.type as Render<unknown>)(fiber.props);
}
observe("first", render({ type: (p: { n: number }) => String(p.n), props: { n: 3 } }));
observe("second", render({ type: (p: { s: string; n: number }) => `${p.s}:${p.n}`, props: { s: "b", n: 4 } }));
done();
