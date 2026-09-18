// `"valueOf" in {}` is `true`, and was `false` here.
//
// Every path in `lower_in` asks which members the receiver's *type* declares,
// and an inherited one is declared by none of them — so a name that every
// object has answered `false`. `in` is defined over the whole prototype chain,
// not over own properties, and `Object.prototype` contributes `valueOf`,
// `toString`, `hasOwnProperty` and the rest to every object there is.
//
// Measured by running test262 `language/expressions/in/S8.12.6_A2_T1.js`, one
// of exactly four files in the 2,527-file slice-1 population that compiled,
// ran, and gave a wrong answer. It emits no diagnostic, so nothing that ranks
// refusals could have found it.
//
// # The precondition
//
// Answering `true` without a lookup is sound only because **no object in a
// program this compiler accepts can have a null prototype**. `Object.create`
// and `Object.setPrototypeOf` are both refused today — checked, not assumed.
// Whoever implements either has to come back to `lower_in`, because
// `Object.create(null)` makes every one of these answers wrong and nothing else
// in the compiler will notice.
//
// # What it does not do
//
// It does not make the member callable. `Object.prototype.hasOwnProperty` is
// still refused as a global member with no definition here, and `"push" in []`
// is still false — `Array.prototype`'s own names are a separate question from
// `Object.prototype`'s. `in` is the half the specification is unambiguous
// about.

const table: Record<string, number> = { present: 1 };

class Holder {
  own = 1;
}

const held = new Holder();
const list: number[] = [1, 2];

// TypeScript's `object`, which is what these sites narrow *to*:
// `value !== null && typeof value === "object" && "k" in value` is how a program
// duck-types an `unknown`, and it is the most common `in` receiver in
// `runtime/node`. `object` is the non-primitive type, so it cannot be a string
// and the reason strings are excluded does not reach it.
//
// TypeScript's `{}` is deliberately **not** covered, and the difference is not
// pedantry: `{}` accepts every value but `null` and `undefined`, strings among
// them, so `"valueOf" in ("a" as {})` throws in node. A receiver whose type
// admits a primitive keeps taking the ordinary path and answers `false` — which
// is still not what node does, but is the existing behaviour rather than a new
// wrong answer.
const narrowed: object = { via: 1 };
const inheritedOnObject: boolean = "valueOf" in narrowed;

export function readInheritedOnObject(): boolean {
  return inheritedOnObject;
}

// Inherited from `Object.prototype`, on three different receiver shapes.
const inheritedOnATable: boolean = "valueOf" in table;
const inheritedOnAClass: boolean = "toString" in held;
const inheritedOnAnArray: boolean = "hasOwnProperty" in list;

// **The controls.** Own membership in both directions, which was already right
// and must stay so: a fix that answers `true` for everything would pass the
// three arms above and fail these.
const ownPresent: boolean = "present" in table;
const ownAbsent: boolean = "absent" in table;
const declaredPresent: boolean = "own" in held;
const declaredAbsent: boolean = "missing" in held;

export function readInheritedOnATable(): boolean {
  return inheritedOnATable;
}

export function readInheritedOnAClass(): boolean {
  return inheritedOnAClass;
}

export function readInheritedOnAnArray(): boolean {
  return inheritedOnAnArray;
}

export function readOwnPresent(): boolean {
  return ownPresent;
}

export function readOwnAbsent(): boolean {
  return ownAbsent;
}

export function readDeclaredPresent(): boolean {
  return declaredPresent;
}

export function readDeclaredAbsent(): boolean {
  return declaredAbsent;
}
