// run: check
// backend: llvm

// Control for a-generic-called-from-a-generic-reads-the-constraint-layout: the same object read by `render` called directly.
interface FormatInput { value: number; digits: number; }
function render<T extends FormatInput>(view: T): number { return view.value; }
function check<T extends FormatInput>(view: T): number { return render(view); }
export function probe(x: number): number {
  return render({ label: "tagged", digits: 1, value: x }) === x ? 1 : 0;
}
