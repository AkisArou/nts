// **Ours, not upstream's.** React's component call in eight lines: a fiber
// keeps its component and its props as `unknown`, and rendering calls the one
// on the other through a generic function type. The React lane reports every
// compiled component crashing here.
//
// **Expected, confirmed under node:**
//
//     rendered   3
//
// With one component in the program the call is devirtualised to it, and
// handed the erased props where the component's object parameter is wanted.
type Render<P> = (props: P) => string;
interface Fiber {
  type: unknown;
  props: unknown;
}
function render(fiber: Fiber): string {
  return (fiber.type as Render<unknown>)(fiber.props);
}
observe("rendered", render({ type: (p: { n: number }) => String(p.n), props: { n: 3 } }));
done();
