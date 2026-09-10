// expect: NTS1001 `this` outside a method
//
// A class **field** holding an arrow function that reads `this`. Not a method,
// so `this` is refused; not a plain field, so the refusal takes the whole class
// with it.
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
// # The message is one and the causes are three
//
// `blockers/this-in-a-default-parameter` and `blockers/this-in-a-static-method`
// both expect this exact text for different constructs. Three shapes, one
// diagnostic -- so a census that groups by message text reports one item here
// and there are three.
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
