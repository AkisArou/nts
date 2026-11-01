// The two literals have the same fields and different getter bodies.
// Direct reads agree; a shared structural view must still select the getter
// belonging to the actual arriving object. The control replaces only each
// getter with the field holding the same value.
const first = { get value() { return 7; } };
const second = { get value() { return 8; } };
function direct(selectSecond: boolean): number {
  return selectSecond ? second.value : first.value;
}
function read(value: { readonly value: number }): number {
  return value.value;
}
function throughInterface(selectSecond: boolean): number {
  return read(selectSecond ? second : first);
}
function throughConditional(selectSecond: boolean): number {
  const value = selectSecond ? second : first;
  return value.value;
}
observe("GETTER_DIRECT", String(direct(false)) + "," + String(direct(true)));
observe("GETTER_INTERFACE", String(throughInterface(false)) + "," + String(throughInterface(true)));
observe("GETTER_CONDITIONAL", String(throughConditional(false)) + "," + String(throughConditional(true)));
done();
