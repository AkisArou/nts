interface Face { readonly budget: number; }
export function raw(n: number): unknown { return { budget: n > 0 ? n : undefined }; }
export function readFace(value: Face): number { return value.budget + 1; }
export function observe(n: number): number { return readFace({ budget: n }); }

interface Values { readonly entries: number[]; }
export function rawValues(n: number): unknown { return { entries: n > 0 ? [n] : undefined }; }
export function readValues(value: Values): number { return value.entries.length; }
export function observeValues(n: number): number { return readValues({ entries: [n] }); }

interface Nested { readonly inner: Face; }
class Computed { get budget(): number { return 17; } }
function nested(value: Nested): number { return readFace(value.inner); }
export function nestedGetter(): number { return nested({inner: new Computed()}); }
export function mappedGetter(): number {
  const values: Face[] = [new Computed()].map(value => value);
  return readFace(values[0]!);
}
export function conditionalGetter(n: number): number {
  const value: Face = n > 0 ? new Computed() : {budget: n};
  return readFace(value);
}

interface Optional { readonly marker?: number; }
class Missing { extra = 7; }
class Marked { marker = 11; }
function marker(value: Optional): unknown { return value.marker; }
export function erasedMarker(n: number): unknown {
  const value: unknown = n > 0 ? new Missing() : new Marked();
  return marker(value as Optional);
}

interface Value { readonly value: number; }
class UnrelatedGetter { get value(): number { return eval("17"); } }
function neverCalledValue(): Value { return new UnrelatedGetter(); }
export function unrelatedGetter(): unknown { return new UnrelatedGetter(); }
export function readValue(value: Value): number { return value.value + 1; }
export function observeValue(n: number): number { return readValue({value: n}); }

// A published constructor constructs its own class and stores a concrete
// literal into Face. Public exposure is not a coercion to every other face.
export class PublicHolder {
  readonly held: Face;
  constructor(n: number) { this.held = {budget: n}; }
  observe(): number { return readFace(this.held); }
}
export function publishedHolder(n: number): number { return new PublicHolder(n).observe(); }

interface Details { budget?: number; note?: string; }
function makeDetails(n: number): Details {
  const details: Details = {};
  details.budget = n;
  return details;
}
export function copyDetails(n: number): unknown {
  const details = makeDetails(n);
  return {...details};
}

// The wrapper's library signature is not the function's receiving contract.
interface Receiver { value: number; }
class ReceiverClass { constructor(public value: number) {} }
function readReceiver(this: Receiver): number { return this.value; }
export function explicitReceivers(n: number): number {
  return readReceiver.call({value: n}) + readReceiver.apply({value: n + 1}, [])
    + readReceiver.bind({value: n + 2})() + readReceiver.call(new ReceiverClass(n + 3));
}
