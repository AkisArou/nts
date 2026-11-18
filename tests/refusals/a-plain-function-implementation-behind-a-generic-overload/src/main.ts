// expect: it calls `fill<viewu8>`, which nothing in this program defines
//
// A plain function implementation behind generic overloads: the call reads the
// overload set's type, pins `fill<viewu8>`, and names that copy -- but the
// implementation has no type parameters, so no copy is made for it and the
// call names nothing. `runtime/node/crypto`'s `randomFill(randomCache, …)` in
// `asyncRefillRandomIntCache` is this shape. A method in the same shape binds
// its implementation's own signature and compiles
// (`tests/programs/a-plain-implementation-behind-a-generic-overload`, the
// control); a function keeps the overload set's reading because the
// result-overload planner depends on it (#861).

type Bytes = ArrayBuffer | ArrayBufferView;
type Done<T> = (error: Error | null, buf?: T) => void;

const cache = new Uint8Array(4);
let seen = 0;

function fill<T extends Bytes>(buf: T, callback: Done<T>): void;
function fill<T extends Bytes>(buf: T, offset: number, callback: Done<T>): void;
function fill(buf: Bytes, offsetOrCallback?: unknown, maybeCallback?: unknown): void {
  const offset = typeof offsetOrCallback === "number" ? offsetOrCallback : 0;
  const callback = (typeof offsetOrCallback === "function" ? offsetOrCallback : maybeCallback) as Done<Bytes>;
  if (offset > 3) {
    throw new RangeError("offset");
  }
  callback(null, buf);
}

function refill(): void {
  fill(cache, (error) => {
    seen = error ? -1 : seen + 1;
  });
}

export function probe(n: number): number {
  seen = n;
  refill();
  return seen;
}
