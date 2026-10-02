// A `var` declared a second time, in a block, read through a closure.
//
// A `var` has no block scope: `{ var x = 'inside'; }` declares the enclosing
// `x` again, so its initializer is an assignment to that one binding, and every
// closure reading `x` reads `'inside'` afterwards. Two halves of this were wrong,
// and test262 found the first (`statements/block/scope-var-none.js`):
//
//   at module scope   the block's declaration was lowered as a fresh local, so
//                     a closure reading the module global saw `'outside'`
//   in a function     the closure captured `x` by value, because a second
//                     declaration was not counted as a write to it
//
// What each export pins (6 is "inside", 7 is "outside"; each answers what the
// closure reads, times ten, plus what a direct read answers):
//
//   atModule        a module-scope `var` redeclared in a block
//   inFunction      a function's `var` redeclared in a block
//   assigned        the control, one difference away: the block assigns
//   bare            `var z: string;` a second time, with no initializer, writes nothing
//   annex           `catch (v) { var v = ... }` assigns the catch *parameter*
//                   (Annex B.3.5): the hoisted `var` keeps what it held
//
// Transcribed from node (v24), each export called with 3:
//
//     atModule 66    inFunction 66    assigned 66    bare 77    annex 1420
// Every declaration first and the blocks after, as a closure-typed global needs:
// no statement that can run code may come before one.
var x = "outside";
var readX = function (): string {
  return x;
};
var y = "outside";
var readY = function (): string {
  return y;
};
var z = "outside";
var readZ = function (): string {
  return z;
};
{
  var x = "inside";
}
{
  y = "inside";
}
{
  var z: string;
}

export function atModule(n: number): number {
  return readX().length * 10 + x.length + n * 0;
}

export function inFunction(n: number): number {
  var w = "outside";
  var read = function (): string {
    return w;
  };
  {
    var w = "inside";
  }
  return read().length * 10 + w.length + n * 0;
}

export function assigned(n: number): number {
  return readY().length * 10 + y.length + n * 0;
}

export function bare(n: number): number {
  return readZ().length * 10 + z.length + n * 0;
}

// Annex B.3.5: the initializer writes the parameter the block can see, not the
// module's `var v`. 14 is "prior to throw", 20 "initializer in catch".
var v = "start";
function readV(): string {
  return v;
}
var caught = "";
v = "prior to throw";
try {
  throw new Error("thrown");
} catch (v) {
  // @ts-ignore TS2403: a redeclaration TypeScript rejects and JavaScript allows
  var v = "initializer in catch";
  caught = String(v);
}

export function annex(n: number): number {
  return readV().length * 100 + caught.length + n * 0;
}
