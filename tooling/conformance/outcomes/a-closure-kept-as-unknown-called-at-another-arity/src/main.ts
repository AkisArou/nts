// **Ours, not upstream's.** A closure that escapes into `unknown` and is
// called back through a function type: the React lane's component call, and
// the shape the uniform-signature thunk exists for. The call site's slot comes
// from the *cast's* signature while the descriptor is the closure's own, and
// React reports 1,253 of 1,255 closure descriptors with no table at all.
//
// **Expected, from JavaScript's own rules and confirmed under node:**
//
//     arity 1 at arity 1 (control)   42
//     arity 1 at arity 2             42
//     arity 0 at arity 2             7
//     arity 2 at arity 1             41undefined
//
// A function declared with fewer parameters ignores the rest; one declared
// with more sees `undefined`. The keys name both arities.
// Inside a function: a module-scope binding holding a cast function is
// refused on its own account and would hide the call.
function run(): void {
  const table = new Map<string, unknown>();
  table.set("inc", (n: number) => n + 1);
  table.set("seven", () => 7);
  table.set("pair", (n: number, s?: string) => `${n}${s}`);

  const inc1 = table.get("inc") as (n: number) => number;
  observe("arity 1 at arity 1 (control)", String(inc1(41)));
  const inc2 = table.get("inc") as (n: number, m: number) => number;
  observe("arity 1 at arity 2", String(inc2(41, 0)));
  const seven2 = table.get("seven") as (n: number, m: number) => number;
  observe("arity 0 at arity 2", String(seven2(1, 2)));
  const pair1 = table.get("pair") as (n: number) => string;
  observe("arity 2 at arity 1", pair1(41));
}
run();
done();
