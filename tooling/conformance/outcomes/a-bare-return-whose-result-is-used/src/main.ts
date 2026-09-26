// `emit-c` exits 0 and `cc` rejects the C: `'vN' undeclared` / `invalid use of
// void expression`. A function whose only return is a bare `return;` has its
// result read. Found by test262's asi/S7.9.2_A1_T4.js and return/S12.9_A3.js.
function t() {
  return;
}
const x = t();
observe("undefined", String(x === undefined));
done();
