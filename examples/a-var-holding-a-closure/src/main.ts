// A module-scope `var` holding a closure.
//
// A `const` or a `let` written once holding an arrow gets a global typed by the
// closure it holds. A `var` was refused, because it hoists: the global is
// readable before its initializer runs, and a slot typed by a closure has no
// `undefined` to hold until then. test262 writes nearly every function-valued
// test this way -- `var f = async function* () {}` and then calls to `f` -- so
// this refusal was the first blocker of 766 language rows.
//
// It is taken now where nothing can read the binding early: one declaration,
// nothing writing it again, the module in no import cycle, and no statement up
// to and including its own that can run program code -- a call, a getter, an
// iterator, a `valueOf`. Whatever runs first, here, is a `var` of a number.
//
// What each export pins:
//
//   arrow       `var double = (x) => x * 2`
//   expression  a `function` expression, which reads a module-scope `var`
//   asynchronous  an `async function` expression, awaited
//   generator   a `function*` expression, iterated
//   both        an `async function*` expression, iterated with `for await`
//
// Transcribed from node (v24), each export called with 3:
//
//     arrow 6    expression 4    asynchronous 9    generator 6    both 9
var offset = 1;

var double = (x: number) => x * 2;

var plusOffset = function (x: number): number {
  return x + offset;
};

var tripled = async function (x: number): Promise<number> {
  return x * 3;
};

var upTo = function* (n: number): Generator<number> {
  for (let i = 1; i <= n; i++) yield i;
};

var countdown = async function* (n: number): AsyncGenerator<number> {
  for (let i = n; i > 0; i--) yield i;
};

export function arrow(n: number): number {
  return double(n);
}

export function expression(n: number): number {
  return plusOffset(n);
}

export async function asynchronous(n: number): Promise<number> {
  return await tripled(n);
}

// The loops' bounds are `(n | 0) & 7`, because the differential calls each
// export over a pool that includes two billion, `Infinity` and `NaN`: a
// generator counting to `n` would be a timeout, not an answer.
export function generator(n: number): number {
  let sum = 0;
  for (const value of upTo((n | 0) & 7)) sum += value;
  return sum;
}

export async function both(n: number): Promise<number> {
  let product = 1;
  for await (const value of countdown((n | 0) & 7)) product *= value;
  return product + n;
}
