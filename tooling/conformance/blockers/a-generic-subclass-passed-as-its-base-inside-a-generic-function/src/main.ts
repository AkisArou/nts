// expect: NTS1001 `Ctx` where `Ctx` is wanted, which is a pointer cast between two structs that do not agree about where their shared fields are
//
// **A generic function that passes its `Ctx<T>` argument to a parameter
// typed as `Ctx`'s base class is refused.** `read<T>` hands `context` to
// `record(context: Base, ...)`; `Ctx<T> extends Base`, so node simply passes
// the object, and the program prints `7 1 ctx 1`. nts refuses `read` and
// `read<f64>` at that argument -- "`Ctx` holds `value` in slot 0 where `Ctx`
// holds `tag`" -- and its refusals listing also names `record@0obj<N>`, a
// copy of `record` made for the argument's type, refused for "a property
// `value` of unrepresentable type (the type parameter `T`)", reported at
// `record`'s parameter. The only statement that calls `read` is cut, so the
// program prints nothing.
//
// **Control**, measured and not kept in this file: `read` written
// non-generic, `function read(context: Ctx<number>): number`, a one-line
// difference. It compiles and prints node's line, so the subclass, the base
// parameter and the upcast all work outside a generic function. Measured as
// not mattering: whether `Base` is abstract, whether a second class extends
// it, and whether `T` is `number` or an interface.
//
// **Measured the same** on 2e8eedb17, c9c1ad7d5, 80615a9aa, 0c7055d82,
// da4a2a4a8 and efc71ad44: it is not new.
//
// **Found by the React lane.** ReactFiberNewContext.ts:468 is this shape:
// `readContext<T>(context: ReactContext<T>)` passes `context` to
// `recordContextDependency(consumer, context: ReactContextBase, value)`, and
// `ReactContext<T> extends ReactContextBase`. Every `useContext` and every
// cache read goes through it. With the LazyComponent, `Array.isArray` and
// component-name roots stood in for (scratch only), it is where the GTK
// counter's chain from `main` stops: beginWork -> updateCacheComponent ->
// readContext<obj#>.
abstract class Base {
  readonly tag: string = "ctx";
  count: number = 0;
  abstract current(): unknown;
}

class Ctx<T> extends Base {
  value: T;
  constructor(value: T) {
    super();
    this.value = value;
  }
  current(): unknown {
    return this.value;
  }
}

const deps: Base[] = [];

function record(context: Base, value: unknown): void {
  deps.push(context);
  context.count += 1;
}

function read<T>(context: Ctx<T>): T {
  const value = context.value;
  record(context, value);
  return value;
}

const ctx: Ctx<number> = new Ctx<number>(7);
console.log(String(read(ctx)) + " " + String(deps.length) + " " + deps[0].tag + " " + String(ctx.count));
