// run: check
//
// Module evaluation reads an interface field whose family lost a supplier:
// `A`'s getter is refused. The refusal cascade found that read every round,
// the initializer's excision could not see it and still answered "cut", and
// `nts check` spun forever on Part 2 stage B's first candidate (71bbfb181).
// Fixed, the read is cut with its statement and `f`, which reads what it
// would have written, is refused by name, as on main; `g` still runs.
interface F { readonly v: number }
class A { get v(): number { Object.setPrototypeOf({}, null); return 1; } }
class B { pad = 0; v = 2 }
function bad(): number { Object.setPrototypeOf({}, null); return 3; }
const items: F[] = [new A(), new B()];
const z = bad();
const first = items[1].v;
export function f(n: number): number { return n + first; }
export function g(n: number): number { return n + items.length; }
