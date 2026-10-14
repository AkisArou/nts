// `super.fill(...)` and `super.subarray(...)` from a class extending a typed
// array.
//
// `Buffer extends Uint8Array` and declares no storage, so `this` inside
// `Buffer#fill` is already a `view<u8>`. The call still went through
// `lower_super`, which builds the name `Uint8Array#fill` and looks for a
// compiled function of it. There is none and there never will be: the method is
// the runtime's.
//
// `subarray` was **already implemented** and `Buffer#subarray` still refused,
// which is what says this was never about the method. One spelling of the call
// reached the runtime's typed-array methods and another could not.
//
// The second half is the optional parameter. `subarray(start?, end?)` forwards
// both to `super.subarray(start, end)`, and an optional is *erased* here --
// so the argument arriving at a view method is routinely an erased value. Its
// payload for `undefined` is zero, indistinguishable from an explicit `0`, and
// `end` defaults to the length rather than to zero. `nts_value_number_or` reads
// the tag where the tag still is.
//
// Every export below forwards optionals, because that is the case that was
// wrong; `explicitRange` is the control that was already right.

class Bytes extends Uint8Array {
  constructor(size: number) {
    super(size);
  }

  filled(value: number, start?: number, end?: number): Bytes {
    super.fill(value, start, end);
    return this;
  }

}

// Why nothing here tests `subarray`, though the fix covers it too.
//
// `TypedArray.prototype.subarray` constructs through the **species**
// constructor: node calls `new Bytes(buffer, byteOffset, length)`, and `Bytes`
// takes one parameter and hands it to `super`, so `new Uint8Array(buffer)` is a
// view over the *whole* buffer. `new Bytes(8).subarray(3)` has length **8** in
// node and 5 under a `subarray` that does what its name says.
//
// This compiler does not implement species construction. That is a real
// divergence and it is named here rather than papered over -- and it is not the
// one this example is about, so a case that walked into it would be testing
// species while claiming to test `super`. The first version of this file did
// exactly that, for six cases, and reported forty disagreements against a fix
// that was working.
//
// `runtime/node`'s `Buffer#subarray` sidesteps it the way node's own
// `lib/buffer.js` does, constructing explicitly from `view.buffer`,
// `view.byteOffset` and `view.byteLength` -- so the super-call path it needs is
// exercised by the compiled tree even though no case here can reach it.
//
// `fill` has no such problem: it returns the receiver and constructs nothing.

/** Both endpoints absent, so both defaults are taken. */
export function fillAll(size: number, value: number): number {
  const b = new Bytes((size % 8) + 1);
  b.filled(value);
  let total = 0;
  for (let i = 0; i < b.length; i++) total += b[i]!;
  return total;
}

/** A start with no end: the end is the length and must not be zero. */
export function fillFrom(size: number, start: number): number {
  const b = new Bytes((size % 8) + 1);
  b.filled(7, start % 4);
  let total = 0;
  for (let i = 0; i < b.length; i++) total += b[i]!;
  return total;
}

/** An explicit zero start, which the erased path must not confuse with absent. */
export function fillFromZero(size: number): number {
  const b = new Bytes((size % 8) + 1);
  b.filled(3, 0);
  let total = 0;
  for (let i = 0; i < b.length; i++) total += b[i]!;
  return total;
}

/** The control: an explicit range through the ordinary call path. */
export function explicitRange(size: number): number {
  const b = new Bytes((size % 8) + 1);
  b.fill(5, 0, 1);
  let total = 0;
  for (let i = 0; i < b.length; i++) total += b[i]!;
  return total;
}

/** A start only, whose end must be the length rather than zero. */
export function fillFromOnly(size: number, start: number): number {
  const b = new Bytes((size % 8) + 1);
  b.filled(9, start % 4);
  let total = 0;
  for (let i = 0; i < b.length; i++) total += b[i]!;
  return total;
}

/** An end only, with an explicit zero start that must not read as absent. */
export function fillToOnly(size: number, end: number): number {
  const b = new Bytes((size % 8) + 1);
  b.filled(2, 0, end % 4);
  let total = 0;
  for (let i = 0; i < b.length; i++) total += b[i]!;
  return total;
}
