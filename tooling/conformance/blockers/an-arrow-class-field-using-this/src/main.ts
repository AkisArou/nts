// expect: lowers
//
// **Kept as a guard. Fixed 2026-09-10.**
//
// A class **field** holding an arrow function that reads `this`. Not a method,
// so `this` was refused; not a plain field, so the refusal took the whole class
// with it.
//
// # The message was about the source and was false
//
// A field initializer is inside a class body and its `this` is the instance.
// What made the compiler say otherwise is that **an initializer is lowered at
// the allocation site**, not in a constructor -- so `initialize_fields` runs
// inside whatever function wrote `new F()`, and for a free function that is a
// builder with no receiver at all. The capture asked `self.this` and got
// nothing.
//
// The receiver it wanted is the object being allocated, which that function
// already holds as a value. `initialize_fields` sets `self.this` to it and
// restores the outer one after, because a `new` can be written inside a method.
//
// # The controls place it as the pair, not either half
//
//     class F { t = 7; read = (): number => this.t; }   REFUSED
//     class M { t = 7; read(): number { return this.t; } }   crosses
//     class N { read = (): number => 5; }                    crosses
//
// Each control is in its **own class**, and that is not cosmetic. The first
// version of this fixture put all three in one class, and the single refused
// field poisoned the other two -- all three exports came back as
// `a declaration outside every walk`, which says nothing about which construct
// was at fault. A control sharing a class with the reduction is not a control.
//
// # The message was one and the causes are three
//
// `blockers/this-in-a-default-parameter` and `blockers/this-in-a-static-method`
// both expected this exact text for different constructs. Three shapes, one
// diagnostic -- so a census that groups by message text reported one item here
// and there were three, and fixing this one leaves the other two saying the same
// words. That is why the count of the text did not fall to zero.
//
// # Where it bites, and why the module cannot route around it
//
// `console` declares its whole published family this way -- `log`, `info`,
// `warn`, `error` and the rest are arrow fields closing over `this` -- and it is
// **5 of that module's 20 own-source roots**, its largest single item.
//
// The obvious rewrite is a prototype method, and it is wrong twice over,
// measured against node rather than assumed:
//
//     node -e "const { log } = console; log('x')"        works
//     Object.prototype.hasOwnProperty.call(console,'log') true
//     'log' in Object.getPrototypeOf(console)             false
//
// Node's `console.log` is an **own property of the instance**, and it survives
// being detached from it. A prototype method is neither: it would move the name
// off the instance where node's own tests can see it, and `const { log } =
// console` would lose its receiver. The arrow field is the faithful shape, so
// this is a refusal to carry rather than a construct to avoid.
//
// # What it turned out to be standing in front of
//
// The same slot -- a field of function type, holding a closure, replaceable
// after construction -- is node's per-instance override idiom:
//
//     if (typeof options.read === "function") this._read = options.read;
//
// the extension mechanism of `Readable`, `Writable`, `Duplex` and `Transform`,
// and **129 failing test files**. `blockers/a-method-assigned-per-instance` is
// the remaining half of that: giving a member written in *method syntax* such a
// slot. This was the half underneath, and it was invisible from there, because
// the refusal that idiom reports is about a function type having no
// representation as a field -- and a field of function type works perfectly.
// The reported cause was not the cause.
//
// `examples/this-in-a-field-initializer` is what asks node: 145 cases, agreeing,
// including a subclass whose own initializer replaces the base's slot.

class FieldArrowUsesThis {
  private total = 7;
  readThis = (): number => this.total;
}

class MethodUsesThis {
  private total = 7;
  readThis(): number {
    return this.total;
  }
}

class FieldArrowNoThis {
  readThis = (): number => 5;
}

/** The reduction. */
export function callFieldArrow(): number {
  return new FieldArrowUsesThis().readThis();
}

/** Control: the same read, as a prototype method. */
export function callMethod(): number {
  return new MethodUsesThis().readThis();
}

/** Control: the same arrow field, not reading `this`. */
export function callFieldArrowNoThis(): number {
  return new FieldArrowNoThis().readThis();
}
