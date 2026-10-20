// An elision over a value typed `any` holding an object of the program's own
// that declares `[Symbol.iterator]`: the elision is one step, so node calls
// `[Symbol.iterator]()` and then `next()` once, and reports made=1 and
// stepped=1. nts reports 0 and 0: an erased value goes through the positional
// loop, where a hole binds nothing and asks no iterator for anything. A silent
// wrong answer, on every backend.
//
// The one-change control is `control`: the same `skip` handed an array,
// whose steps nothing observes, and which agrees. Wasm's outcome
// an-elision-over-a-generator-does-not-step-it is the same defect for a
// generator.
//
// **Since 2026-10-20 it stops by name**, at run time, when such an object
// arrives: "an array pattern stepping an object through its own
// `[Symbol.iterator]`". Those calls are user code that the implicit-call
// analysis does not know this site reaches, so the step is not compiled yet,
// and a stop is honest where the silent no-step was not. Everything before it
// agrees. A change that steps the protocol turns this into agreement.
let made = 0;
let stepped = 0;

class Countdown {
  [Symbol.iterator](): Iterator<number> {
    made = made + 1;
    return {
      next(): IteratorResult<number> {
        stepped = stepped + 1;
        return { value: stepped, done: false };
      },
    };
  }
}

function skip([,]: any): void {}

observe("before", String(made + stepped));
const values = [7, 8];
skip(values);
observe("control", String(values.length));
skip(new Countdown());
observe("made", String(made));
observe("stepped", String(stepped));
done();
