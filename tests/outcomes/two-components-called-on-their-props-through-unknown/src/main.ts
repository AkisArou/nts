// **FIXED by `519195e49` and kept as a guard.** This was `aborted (SIGSEGV)`:
// React's every-compiled-component crash, reduced. `Closure3117__call` was
// reached as `NtsValue (*)(NtsObj_Fn41020_48552__3921 *, NtsMap *, NtsValue)`,
// and the site *cannot* know which closure it holds because the component
// arrives from `fiber.type`, which is erased -- so the fix had to be at the
// callee, and is: a uniform entry every closure implements. Kept as `agrees`
// because a segfault that becomes a right answer is exactly the thing a guard
// should notice going back.
//
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
