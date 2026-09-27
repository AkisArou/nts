// **A value built as one interface, carried as `unknown`, and read back through
// another interface it satisfies structurally, reads the second interface's fields
// at the second interface's offsets.** `$$typeof` is at index 0 of `Elem` and index
// 0 of `Tagged`, and the two are not the same slot, because the layouts are not the
// same layout. nts answers "not an element"; node answers "element box".
//
// It is an unchecked unerase to a laid-out type, which is the family
// `an-erased-record-read-through-an-interface` records for a **table** arriving
// where a struct is wanted. This is the other half: a *struct* arriving where a
// different struct is wanted, which no `coerce` sees because the value is erased
// in between.
//
// The control is the same value read through the interface it was built as, in the
// same program -- nothing aborts here, so a control can sit beside the subject and
// say the defect is the *view* rather than the value or the erasure.
//
// Found by the React lane: every child and type dispatch in their port reads
// `$$typeof` through a view like this, about twenty-five sites across
// ReactChildFiber, BeginWork, Fiber, Hooks, ClassComponent, ReactChildren and JSX.
// With their stand-ins in place the counter reaches `reconcileChildFibersImpl`, the
// root element's `$$typeof` misreads, the switch misses, and it lands in
// `throwOnInvalidObjectType`.
//
// On the day a read through an erased view is checked or keyed, this reads CHANGED:
// either "through another interface" answers as node does, or it stops by name.
const ELEMENT: symbol = Symbol.for("react.element");

interface Elem {
  readonly $$typeof: symbol;
  readonly type: unknown;
  readonly key: string | null;
}

interface Tagged {
  readonly $$typeof?: unknown;
  readonly then?: unknown;
}

function make(type: string): unknown {
  const element: Elem = { $$typeof: ELEMENT, type, key: null };
  return element;
}

function throughAnotherInterface(child: unknown): string {
  if (typeof child === "object" && child !== null) {
    const tagged = child as Tagged;
    if (tagged.$$typeof === ELEMENT) {
      return "element " + ((child as Elem).type === "box" ? "box" : "?");
    }
    return "not an element";
  }
  return "not an object";
}

function throughItsOwnInterface(child: unknown): string {
  if (typeof child === "object" && child !== null) {
    const element = child as Elem;
    if (element.$$typeof === ELEMENT) {
      return "element " + (element.type === "box" ? "box" : "?");
    }
    return "not an element";
  }
  return "not an object";
}

observe("through another interface", throughAnotherInterface(make("box")));
observe("through its own interface", throughItsOwnInterface(make("box")));
done();
