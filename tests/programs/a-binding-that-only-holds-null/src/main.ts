// A null-only declaration still needs a storage representation. Richards uses
// this shape for its module-level NO_TASK and NO_WORK constants.
//
// The paired module controls change only null to undefined. Both are absent values;
// neither requires a pointer layout. This must not change how a nullable
// reference is represented, nor give void-returning calls a stored value.

const NO_TASK = null;
const NO_WORK = undefined;

export function aModuleNull(n: number): number {
  return (NO_TASK === null ? 10 : 20) + n;
}

export function aModuleUndefined(n: number): number {
  return (NO_WORK === undefined ? 10 : 20) + n;
}

let selected: null | undefined = null;

export function theTagsStayDistinct(n: number): number {
  selected = n > 0 ? undefined : null;
  return (selected === null ? 1 : 0) + (selected === undefined ? 10 : 0);
}

class Nullable {
  value: string | null = "ab";
}

// A narrowed read is still a pointer stored in the declared nullable field.
// A blanket Null => Erased representation would break this control.
export function aNarrowedPointerStaysAPointer(n: number): number {
  const box = new Nullable();
  if (n > 0) box.value = null;
  return box.value === null ? 1 : box.value.length;
}

let effects = 0;

function noValue(): void {
  effects++;
}

export function aVoidCallStillRuns(n: number): number {
  effects = 0;
  noValue();
  return effects + n;
}
