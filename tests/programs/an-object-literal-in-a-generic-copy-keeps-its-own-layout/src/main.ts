// An object literal inside a generic copy is built at that copy's own record.
//
// `{ value }` inside `hold<T>` has the type `{ value: T }`: an anonymous record
// with no symbol and no type arguments, whose only mention of `T` is its
// property. The substitution walk read it as concrete, so every copy of `hold`
// shared one record and one layout, laid out by whichever copy asked first:
// `hold<str>` stored a string into the double `hold<f64>` had laid out, and
// preparation stopped with `StoreType { func: "hold<str>", what: "a field",
// expected: Float { bits: 64 }, found: Managed(String) }`. Each copy now gets the
// record its own arguments make.
//
// `sameType` is the control: both copies bind `T` to `number`, so one layout was
// right for both and it prepared before the fix. It differs from `mixed` in the
// second copy's argument type alone.
//
// Each literal escapes into `last`, and each arm empties it again before it
// returns: under reference counting the harness compares what is live after
// the first case with what is live at the end, and a sink still holding the
// last arm's object reads as a leak.

let last: unknown = 0;

function hold<T>(value: T): number {
  const box = { value };
  last = box;
  last = 0;
  return 1;
}

export function mixed(n: number): number {
  return hold(n) + hold("s");
}

export function sameType(n: number): number {
  return hold(n) + hold(n + 1);
}

// One difference from `mixed`: the record also names the function's own type,
// whose signature binds a `T` of the same identity. That binding holds within
// the signature alone, so `value` still makes the record differ per copy.
function holdNamed<T>(value: T): number {
  const box: { value: T; again?: typeof holdNamed } = { value };
  last = box;
  last = 0;
  return 1;
}

export function namedItsOwnType(n: number): number {
  return holdNamed(n) + holdNamed("s");
}

// Read back: an annotated type literal, a nested literal and an array field,
// each laid out per copy and read at the copy's own field types.
function measure<T>(value: T, size: (v: T) => number): number {
  const box: { value: T } = { value };
  const nested = { inner: { value }, items: [value, value] };
  last = nested;
  last = 0;
  return size(box.value) + size(nested.inner.value) + nested.items.length;
}

export function measured(n: number): number {
  return measure(n, (v) => v * 2) + measure(String(n), (s) => s.length);
}

// The same literal written in a generic class's method: one record per
// instantiation of the class.
class Keeper<T> {
  keep(value: T): T {
    const box = { value };
    last = box;
    last = 0;
    return box.value;
  }
}

export function kept(n: number): number {
  return new Keeper<number>().keep(n) + new Keeper<string>().keep(String(n)).length;
}

// A record holding a library generic, queued in a field of a class that only
// another generic instantiates. **This arm agrees on the compiler before the
// fix as well**, where `Pending<T>`'s records read as concrete and every copy
// shared one queue: it guards the change against a regression of its own.
// Made to count, the records named a library generic with no declaration, and
// without instantiating one from its own record `Requests<number>` lost its
// `#pending` field and was refused. `PromiseWithResolvers` is declared in a file
// the frontend does not decode, so it has no declaration to instantiate from:
// `Requests<number>` is made from inside `Owner<number>`, and its `#pending`
// field has to substitute `Pending<T>`'s `PromiseWithResolvers<IteratorResult<
// T>>` through a type whose `then<TResult1>` binds a parameter of its own.
class Queue<T> {
  #items: T[] = [];
  push(item: T): void {
    this.#items.push(item);
  }
  get size(): number {
    return this.#items.length;
  }
}

type Pending<T> = {
  readonly kind: "next";
  readonly result: PromiseWithResolvers<IteratorResult<T, unknown>>;
};

class Requests<T> {
  readonly #pending = new Queue<Pending<T>>();
  add(): number {
    const result = Promise.withResolvers<IteratorResult<T, unknown>>();
    this.#pending.push({ kind: "next", result });
    return this.#pending.size;
  }
}

class Owner<T> {
  count(): number {
    const requests = new Requests<T>();
    requests.add();
    return requests.add();
  }
}

export function queued(n: number): number {
  return new Owner<number>().count() + new Owner<string>().count() + n;
}

// A literal's own members -- a getter, a method holding a closure, a method in
// a generic class's copy -- are lowered once per copy of the generic around
// it, against that copy's record, under the name the copy calls.
function described<T>(value: T, size: (v: T) => number): number {
  const box = {
    value,
    get current(): T {
      return this.value;
    },
    describe(): string {
      const twice = (): string => typeof this.value + ":" + typeof this.current;
      return twice();
    },
  };
  return box.describe().length + size(box.current);
}

export function describedEach(n: number): number {
  return described(n, (v) => v * 2) + described(String(n), (s) => s.length);
}

class Shelf<T> {
  label(value: T): string {
    const item = {
      value,
      tag(): string {
        return typeof this.value;
      },
    };
    return item.tag();
  }
}

export function shelved(n: number): string {
  return new Shelf<number>().label(n) + new Shelf<string>().label(String(n));
}

// A literal member in a generic class's copy calling a generic function at the
// class's parameter: the member is owned by the literal's record, but its call
// binds `measureOf`'s `V` to `T` exactly as the enclosing method's own calls
// do, so each copy names its own callee -- `measureOf<f64>` in `Scale<number>`,
// `measureOf<str>` in `Scale<string>` -- through the class copy's call answers.
function measureOf<V>(value: V): number {
  return [value, value].length;
}

class Scale<T> {
  weigh(value: T): number {
    const item = {
      value,
      weight(): number {
        return measureOf(this.value) + 1;
      },
    };
    return item.weight();
  }
}

export function weighed(n: number): number {
  return new Scale<number>().weigh(n) + new Scale<string>().weigh(String(n));
}

// Literal methods a declared field type makes storage: `pull` and `cancel` capture
// the enclosing `reader`, so each is the closure that fills its slot. Each copy's
// record keeps the form's slots, so the closures go in and are called there.
type PullOf<T> = (sink: T[]) => void;
interface SourceOf<T> {
  pull?: PullOf<T>;
  cancel?: (reason: unknown) => void;
}
class StreamOf<T> {
  constructor(readonly source: SourceOf<T>) {}
}
function transferred<T>(items: T[]): StreamOf<T> {
  const reader = items;
  return new StreamOf<T>({
    pull(sink) {
      sink.push(reader[0]!);
    },
    cancel(reason) {
      reader.length = reason === undefined ? 0 : 1;
    },
  });
}
export function moved(n: number): number {
  const a = transferred([n, n + 1]);
  const b = transferred(["s" + n]);
  const outA: number[] = [];
  const outB: string[] = [];
  a.source.pull?.(outA);
  b.source.pull?.(outB);
  b.source.cancel?.(undefined);
  return outA[0]! + outB[0]!.length;
}
