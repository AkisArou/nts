// Computed membership is an own-property query plus the prototype chain.
// The control changes only the key to an own entry. A table does not record
// its prototype (including Object.create(null)), so inherited names stop.
function contains(values: Record<string, number>, key: any): boolean { return key in values; }
const values: Record<string, number> = { x: 7 };
observe("own key control", String(contains(values, "x")));
observe("inherited key", String(contains(values, "toString")));
done();
