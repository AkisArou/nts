// Control for a-generic-called-from-a-generic-reads-the-constraint-layout: the same object read by `render` called directly.
interface FormatInput { value: number; digits: number; }
function render<T extends FormatInput>(view: T): number { return view.value; }
function check<T extends FormatInput>(view: T): number { return render(view); }
observe("value read through one generic", String(render({ label: "tagged", digits: 1, value: 2.5 }) === 2.5));
done();
