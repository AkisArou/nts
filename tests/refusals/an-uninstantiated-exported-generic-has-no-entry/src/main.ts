// expect: an exported generic function this program never instantiates
//
// Reduced from node:timers setInterval's missing callback API. The exported
// generic has no concrete call in the module, so Node-API has no specialization
// to publish. The control keeps the identical generic body, but calls it once
// at a concrete numeric type through a scalar entry. Renamed copies prevent
// the control's call from instantiating the subject too.
export function subject<T>(value: T): T {
  return value;
}
function identity<T>(value: T): T {
  return value;
}
export function control(value: number): number {
  return identity(value);
}
