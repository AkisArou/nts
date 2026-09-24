// One function per counting rule, each with a hand-countable answer.
//
// Every member name is used once, so a test can assert on `(member, form,
// access)` without an owner disambiguating it — and so a rule that fires twice
// or not at all is visible as a count rather than as a wrong total.

import type {
  Declared,
  Keyed,
  Mixed,
  Named,
  OnlyOptional,
  TwoCoverers,
  Uninhabitable,
} from "./shapes.js";
import * as shapes from "./shapes.js";

/** Covers `Declared` by saying so. */
export class Sayer implements Declared {
  declaredField = 1;
  constructor(n: number) {
    this.declaredField = n;
  }
}

/** Covers `Named`'s members without saying anything: a structural satisfier. */
export class Quiet {
  forDots = "";
  forKeys = "";
  forOne = "";
  forTwo = "";
  forStrings = "";
  forWriting = 0;
  forCompound = 0;
  ownToItself = "";
}

/** A dot. One read. */
export function dotted(v: Named): string {
  return v.forDots;
}

/** A literal key names a field: `names_a_property` routes it to the same place. */
export function keyedByALiteral(v: Named): string {
  return v["forKeys"];
}

/** A computed index names nothing. Zero field accesses, and a table besides. */
export function keyedByAVariable(v: Keyed, i: string): number {
  return v[i];
}

/** Two reads and no property-access node at all. */
export function destructured(v: Named): string {
  const { forOne, forTwo } = v;
  return forOne + forTwo;
}

/** Seven reads, on the spread row rather than the site row. */
export function spread(v: Named): Named {
  return { ...v };
}

/** A method is dispatched, not loaded. Zero. */
export function aMethod(v: Mixed): string {
  return v.describe();
}

/** An accessor is a call that looks like a load. Zero. */
export function anAccessor(v: Mixed): number {
  return v.derived;
}

/** A field that happens to be read alongside them. One. */
export function aFieldBesideThem(v: Mixed): number {
  return v.stored;
}

/** A table read through a dot still has no fixed offset. Zero. */
export function anIndexSignature(v: Keyed): number {
  return v.anything;
}

/** One, not two: the receiver of `.length` is a `string`. */
export function throughAString(v: Named): number {
  return v.forStrings.length;
}

/** One write. */
export function written(v: Named, n: number): void {
  v.forWriting = n;
}

/** One read-modify-write, counted once rather than as a read and a write. */
export function readModifyWritten(v: Named): void {
  v.forCompound += 1;
}

/** An interface nothing can inhabit: the bracket's lower arm. */
export function uninhabitable(v: Uninhabitable): string {
  return v.nobodyHasThis;
}

/** An interface a class names: the bracket's upper arm. */
export function declared(v: Declared): number {
  return v.declaredField;
}

/** A class receiver reads at a fixed offset today and would keep doing so. */
export function aClass(v: Quiet): string {
  return v.ownToItself;
}

/**
 * A module member is not a field: `shapes.LIMIT` resolves a name at compile time
 * and loads no slot, which is what `names_a_property` says outright.
 *
 * It must not reach the denominator. In `runtime/node` 305 accesses did, and
 * every one of them was a module namespace -- `zlib/src/constants` alone was 170.
 */
export function throughAModule(n: number): number {
  return shapes.LIMIT + n;
}

/**
 * A library receiver: declared outside the decoded files, so nothing here can
 * say whether it is an interface. `Math` is the unambiguous half of that bucket
 * -- it reads no slot this program lays out -- which is why the census prints
 * two denominators rather than folding the bucket either way.
 */
export function throughALibrary(n: number): number {
  return Math.PI * n;
}

/** Covers `TwoCoverers` at index 0. */
export class FirstCoverer {
  coveredTwice = "first";
  padding = 0;
}

/** Covers it at index 2, which is why neither arm can read at the other's. */
export class SecondCoverer {
  padding = 0;
  other = 0;
  coveredTwice = "second";
}

/** Says `implements` where no required name exists to compare. */
export class Opting implements OnlyOptional {
  perhaps = 1;
}

/** One read through a three-arm receiver. */
export function throughTwoCoverers(v: TwoCoverers): number {
  return v.coveredTwice.length;
}

/** One read through a receiver only an `implements` clause reaches. */
export function throughOnlyOptional(v: OnlyOptional): number {
  return v.perhaps ?? 0;
}
