// **A generic function that passes its `Ctx<T>` argument to a parameter
// typed as `Ctx`'s base class was refused.** `read<T>` hands `context` to
// `record(context: Base, ...)`; `Ctx<T> extends Base`, so node simply passes
// the object and prints `7 1 ctx 1`. nts refused `read<f64>` at that
// argument -- "`Ctx` holds `value` in slot 0 where `Ctx` holds `tag`" -- and
// the module-scope statement calling it was cut.
//
// **The cause**: calls are planned from the checker's type of each argument,
// and inside `read<T>` that is the open `Ctx<T>`. A copy of `record` was made
// for it, `record@0obj<N>`, laid out with no base (open forms are not
// instantiations, so none was given one), and `read<f64>` converted its
// `Ctx<number>` to that copy's parameter. No copy is made for an open form
// now: `read<f64>` calls `record` itself, and `Ctx<number>` to `Base` is a
// base-first prefix.
//
// **Control**, measured and not kept in this file: `read` written
// non-generic, `function read(context: Ctx<number>): number`, which always
// agreed.
//
// Was `tooling/conformance/blockers/`. **Found by the React lane.**
// ReactFiberNewContext.ts:468 is this shape: `readContext<T>(context:
// ReactContext<T>)` passes `context` to `recordContextDependency(consumer,
// context: ReactContextBase, value)`, and `ReactContext<T> extends
// ReactContextBase`. Every `useContext` and every cache read goes through it.
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
observe("a Ctx<number> passed as its base inside read<T>", String(read(ctx)) + " " + String(deps.length) + " " + deps[0].tag + " " + String(ctx.count));
done();
