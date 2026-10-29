// A written value claim never proves what an unchecked arrival contains.
// Each control changes only its parameter annotation to the representation.
export function claimed(value: 64): number { return value + 1; }
export function claimControl(value: number): number { return value + 1; }
export function literalArrival(value: number): number { return claimed(value as 64); }
export function literalControl(value: number): number { return claimControl(value); }

export function unionClaim(value: 0 | 1): number { return value + 1; }
export function unionControl(value: number): number { return value + 1; }
export function unionArrival(value: number): number { return unionClaim(value as 0 | 1); }

export function stringClaim(value: "x"): number { return value.length; }
export function stringControl(value: string): number { return value.length; }
export function stringArrival(value: string): number { return stringClaim(value as "x"); }

const enum Fixed { Value = 64 }
export function enumClaim(value: Fixed.Value): number { return value + 1; }
export function enumControl(value: number): number { return value + 1; }
export function enumArrival(value: number): number { return enumClaim(value as Fixed.Value); }

// A typed handler slot has the ordinary numeric ABI. Its declaration does not
// check what a callback caller passes. The erased function-entry contract is
// a separate checked boundary, pinned by checkedCallback below.
interface Callback { call(value: 64): number; }
class ClaimedCallback { call(value: 64): number { return value + 1; } }
class ControlCallback { call(value: number): number { return value + 1; } }
function invoke(callback: Callback, value: number): number {
  return callback.call(value as 64);
}
export function callbackArrival(value: number): number {
  return invoke(new ClaimedCallback(), value);
}
export function callbackArrivalControl(value: number): number {
  return invoke(new ControlCallback(), value);
}
function checkedClaim(value: 64): number { return value + 1; }
function checkedInvoke(callback: (value: number) => number, value: number): number {
  return callback(value);
}
export function checkedCallback(value: number): number {
  const admitted = value === 64 ? value : 64;
  return checkedInvoke(checkedClaim as (value: number) => number, admitted);
}

function jsClaim(value: 64): number { return value + 1; }
function jsControl(value: number): number { return value + 1; }
export function javascriptArrival(value: unknown): number { return jsClaim(value as 64); }
export function javascriptControl(value: unknown): number { return jsControl(value as number); }
export function erasedArrival(value: number): number { return javascriptArrival(value); }
export function erasedControl(value: number): number { return javascriptControl(value); }

// The one actual literal caller remains a value proof after the correction.
function proved(value: 64): number { return value + 1; }
export function provenCaller(): number { return proved(64); }
