// The neighbourhood of the known defect, so a fix can be scoped to it.
//
// `an-optional-field-across-an-erased-slot` is one point: an optional `number`
// present in the literal, through a union parameter that erases. These vary one
// thing at a time around it.

type Fn = (n: number) => void;

interface OptNumber { limit?: number; }
interface OptString { name?: string; }
interface TwoOptional { a?: number; b?: number; }
interface MixedOptional { a?: number; b: number; }

function erasedNumber(o: OptNumber | Fn | undefined): OptNumber | undefined {
  if (typeof o === "function") return undefined;
  return o;
}
function erasedString(o: OptString | Fn | undefined): OptString | undefined {
  if (typeof o === "function") return undefined;
  return o;
}
function erasedTwo(o: TwoOptional | Fn | undefined): TwoOptional | undefined {
  if (typeof o === "function") return undefined;
  return o;
}
function erasedMixed(o: MixedOptional | Fn | undefined): MixedOptional | undefined {
  if (typeof o === "function") return undefined;
  return o;
}

/** The known point, restated here so this file stands alone. */
export function optionalNumberPresent(): number {
  const back = erasedNumber({ limit: 19 });
  return back === undefined ? -1 : (back.limit ?? -2);
}

/** The same, with the optional field absent from the literal. */
export function optionalNumberAbsent(): number {
  const back = erasedNumber({});
  return back === undefined ? -1 : (back.limit ?? -2);
}

/** A string rather than a number: is it the field's type? */
export function optionalStringPresent(): number {
  const back = erasedString({ name: "abc" });
  return back === undefined ? -1 : (back.name ?? "").length;
}

/** Two optional fields, both present. */
export function twoOptionalPresent(): number {
  const back = erasedTwo({ a: 3, b: 4 });
  return back === undefined ? -1 : (back.a ?? -2) + (back.b ?? -2);
}

/** One optional and one required, so the struct is not uniformly tagged. */
export function mixedOptionalAndRequired(): number {
  const back = erasedMixed({ a: 5, b: 6 });
  return back === undefined ? -1 : (back.a ?? -2) + back.b;
}

/** The required field of a mixed struct, which should be unaffected. */
export function mixedRequiredOnly(): number {
  const back = erasedMixed({ b: 7 });
  return back === undefined ? -1 : back.b;
}
