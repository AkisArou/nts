// A getter on an object literal is an own enumerable property, and every
// enumeration dropped it.
//
//     const src = { get a(): number { return 1; }, b: 2 };
//
//     Object.keys(src)            "b"     node "a,b"
//     for (const k in src)        "b"     node "ab"
//     Object.values(src).length    1      node 2
//     Object.entries(src)          same omission
//     Object.hasOwn(src, "a")     false   node true
//
// **And `"a" in src` was right the whole time**, which is what made this
// findable and what said the information was never missing. `in` goes through
// `declares(type, key)` --- a question about the *type* --- and enumeration
// went through `enumerable_fields`, a question about the **layout**. A layout
// holds storage and an accessor is a call, so it has no entry there at all. One
// question, two derivations, two answers.
//
// The same cause as `examples/a-spread-that-runs-a-getter`, which was the sixth
// consumer and was fixed first.
//
// # What `own` does not mean
//
// The obvious discriminator is `PropertyRecord::own`, and it is `false` for a
// class's accessor **and for a literal's alike** --- read out of `nts types`
// after assuming otherwise twice. A class's accessor is installed on the
// prototype and is genuinely not an own property; a literal's is a property of
// the object. What separates them is where the member is written, so that is
// what is asked.
//
// The walk goes **up to whichever of a literal or a class comes first**, not to
// the immediate parent: the encoder puts members in a node list, so an
// accessor's parent is the list. Testing the parent directly answered `false`
// for every literal, which left the consumers broken and the class controls
// passing --- indistinguishable, from the outside, from the guard working.
//
// # The three arms that are not a value
//
// `theOrderTwoGettersRunIn` pins that `Object.values` runs them in the order it
// reports them. `aGetterRunsOncePerEnumeration` pins that it is called rather
// than read from a slot that happens to hold the right number. And the class
// arms below pin the half that must **not** move: a prototype member stays out
// of all of it, which is the direction this change could have broken and did,
// once, before the controls caught it.
//
// A set-only property is refused by name rather than answered: it enumerates,
// and its value is `undefined`, which the element has no width for. That is a
// representation decision and it is not made here.
//
// # A method shorthand, which is the same seam
//
// A **method shorthand** on an object literal is an own enumerable property
// too, and it was dropped by the same three consumers:
//
//     const o = { m(): number { return 1; }, v: 2 };
//     Object.keys(o)                "v"      node "m,v"
//     for (const k in o)            "v"      node "mv"
//     Object.hasOwn(o, "m")         false    node true
//
// `"m" in o` and `{ ...o }` were right already --- the same two that were right
// about the accessor, for the same reason. So this file is about members with
// **no layout storage**, of which an accessor and a literal's method are the
// two kinds.
//
// **The names enumerate; the value is refused by name.** A method's value is a
// function object, and `bound_method` --- the thing that builds one --- reads
// the member off a property-access node, which an enumeration does not have. So
// `Object.values({ m() {}, v: 2 })` says
//
//     `m`, a method of an object literal, in `Object.values` --
//     it enumerates and its value is a function object
//
// where it used to return an array one element short. A refusal that names the
// construct in place of a quietly wrong length is the trade, and the remaining
// work is a closure built from a receiver and a name.
//
// The comment in `Object.hasOwn`'s own lookup asserted the opposite --- "a
// method is declared and is not an own property" --- which is true of a
// **class** method, on the prototype, and false of this one.

// # Every arm is pure, and that took a second attempt
//
// The side effects are observed **once, at module scope**, and the exports read
// what was recorded. Written the obvious way --- an export that enumerates and
// then reports the counter --- each arm mutated shared state, and the
// differential drives every export many times: `order` grew on each call and
// the run aborted under reference counting. Nothing was wrong with the compiler
// and the fixture could not say so.

let runs = 0;
let order = "";

const withAGetter = {
  get computed(): number {
    runs += 1;
    return 1;
  },
  plain: 2,
};

const twoGetters = {
  get first(): number {
    order += "f";
    return 1;
  },
  get second(): number {
    order += "s";
    return 2;
  },
};

const indexAndName = {
  get named(): number {
    return 5;
  },
  2: 9,
};

class Shaped {
  field = 1;
  get derived(): number {
    return this.field * 2;
  }
  method(): number {
    return 3;
  }
}
const instance = new Shaped();

// **The order arms, which exist because this change broke them once.**
//
// The checker's member list is *own-first* and a layout is *base-first*, so
// walking properties unconditionally renamed `Object.keys(new Derived())` from
// `a,b,c,d` to `c,d,a,b`.
//
// **The corpus already covered this and the gate caught it.** A probe found it
// first, minutes earlier, only because the gate takes forty and was still
// running --- and the commit that fixed it claimed the gate "was green on it
// and always would have been", which was an assumption written as a fact.
// `key-order-follows-the-program` and `key-order-through-an-extended-interface`
// are two examples that exist for exactly this, and the run said so:
// `^ fell from 296 to 294`.
//
// The arms below are still worth having --- they put the failure next to its
// cause rather than two directories away --- but the lesson is the opposite of
// the one first written down. Before claiming nothing covers a thing, look for
// a fixture named after it.
//
// The list keeps the layout's order unless a literal accessor is present ---
// and an accessor only ever reaches it from a literal, where layout order,
// property order and source order are the same thing.
class Base {
  first = 1;
  second = 2;
}
class Derived extends Base {
  third = 3;
  fourth = 4;
}
const derived = new Derived();

class Shadowing extends Base {
  second = 9;
  third = 3;
}
const shadowing = new Shadowing();

const withAMethod = {
  describe(): number {
    return 1;
  },
  plainValue: 2,
};

// Observed once, in module order, so every export below is a pure read.
const runsBefore = runs;
const twoGetterValues = Object.values(twoGetters).join("");
const orderTheyRanIn = order;
const enumeratedValues = Object.values(withAGetter).join(",");
const runsAfter = runs;

export function keysNameTheGetter(): string {
  return Object.keys(withAGetter).join(",");
}

export function forInVisitsTheGetter(): string {
  let seen = "";
  for (const key in withAGetter) {
    seen += key;
  }
  return seen;
}

export function valuesRunTheGetter(): string {
  return enumeratedValues;
}

export function entriesCarryBoth(): string {
  return Object.entries(withAGetter)
    .map((pair) => pair[0] + pair[1])
    .join(",");
}

export function hasOwnFindsTheGetter(n: number): number {
  return (Object.hasOwn(withAGetter, "computed") ? 1 : 0) * 10 + n;
}

export function inAgreesWithHasOwn(n: number): number {
  const both =
    ("computed" in withAGetter ? 1 : 0) +
    (Object.hasOwn(withAGetter, "computed") ? 1 : 0);
  return both * 10 + n;
}

/// One enumeration ran the getter once, rather than reading a slot.
export function aGetterRanOncePerEnumeration(): number {
  return runsAfter - runsBefore;
}

export function theOrderTwoGettersRanIn(): string {
  return orderTheyRanIn + twoGetterValues;
}

export function anArrayIndexStillSortsFirst(): string {
  return Object.keys(indexAndName).join(",");
}

export function aPrototypeGetterStaysOut(): string {
  return Object.keys(instance).join(",");
}

export function aPrototypeMethodStaysOut(n: number): number {
  return (Object.hasOwn(instance, "method") ? 1 : 0) * 10 + n;
}

export function aPrototypeGetterIsNotOwn(n: number): number {
  return (Object.hasOwn(instance, "derived") ? 1 : 0) * 10 + n;
}

export function inheritedFieldsComeFirst(): string {
  return Object.keys(derived).join(",");
}

export function aShadowedFieldKeepsItsFirstPosition(): string {
  return Object.keys(shadowing).join(",");
}

export function aMethodShorthandEnumerates(): string {
  return Object.keys(withAMethod).join(",");
}

export function forInVisitsAMethodShorthand(): string {
  let seen = "";
  for (const key in withAMethod) {
    seen += key;
  }
  return seen;
}

export function hasOwnFindsAMethodShorthand(n: number): number {
  return (Object.hasOwn(withAMethod, "describe") ? 1 : 0) * 10 + n;
}

export function aMethodShorthandIsStillCallable(n: number): number {
  return withAMethod.describe() * 10 + n;
}

export function aPrototypeMethodIsNotOwn(n: number): number {
  return (Object.hasOwn(instance, "method") ? 1 : 0) * 10 + n;
}
