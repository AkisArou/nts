// run: check
// backend: jvm

// A generic function called from another generic is instantiated at its
// constraint, so C and LLVM read the argument through the constraint's layout:
// `value` comes from the slot that holds `label`, and the number read is that
// string pointer's bits. The JVM refuses the call. Called directly, `render`
// agrees on every backend. Found by the number-format-routes controls; the
// same class as a-second-generic-record-keeps-its-number-field.
interface FormatInput { value: number; digits: number; }
function render<T extends FormatInput>(view: T): number { return view.value; }
function check<T extends FormatInput>(view: T): number { return render(view); }
export function probe(x: number): number {
  return check({ label: "tagged", digits: 1, value: x }) === x ? 1 : 0;
}
