// Subject/control differ only in numeric versus canonical string key syntax.
let stored = 0;
/** @param {number} n @returns {number} */
export function subject(n) {
  stored = n;
  const value = { get [0.0000001]() { return stored; }, set [0.0000001](x) { stored = x; } };
  value['1e-7'] = n + 1;
  return value['1e-7'];
}
/** @param {number} n @returns {number} */
export function control(n) {
  stored = n;
  const value = { get ['1e-7']() { return stored; }, set ['1e-7'](x) { stored = x; } };
  value['1e-7'] = n + 1;
  return value['1e-7'];
}
