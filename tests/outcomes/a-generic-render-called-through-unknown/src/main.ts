// **Ours, not upstream's.** A component kept as `unknown` and called through
// a generic function type instantiated at the call: `Render<P>` at `P` =
// `{ n: number }`. The uniform-signature thunk's generic face.
//
// **Expected, confirmed under node:**
//
//     rendered   3
type Render<P> = (props: P) => string;
function call<P>(component: unknown, props: P): string {
  return (component as Render<P>)(props);
}
observe("rendered", call((p: { n: number }) => String(p.n), { n: 3 }));
done();
