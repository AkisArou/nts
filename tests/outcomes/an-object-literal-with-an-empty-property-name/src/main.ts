// run: build
//
// The empty string is a property name like any other: node prints 1 and 2.
// nts lays the literal out with a field named "", and the C emitter then
// stops on a panic, because it derives the field's C identifier from the
// name and the empty name gives none ("invalid emitted C identifier"). The
// JVM backend compiles the same program. `Record<"" | "a", number>` stops the
// same way, and in the census of 2026-11-06 on pin e0395d27506b three test262
// cases stop there (built-ins/Object/defineProperty/15.2.3.6-2-33,
// getOwnPropertyDescriptor/15.2.3.3-2-32 and getOwnPropertyNames/15.2.3.4-4-b-3).
// The control, an-object-literal-with-an-empty-property-name-control, names the
// field `b` and agrees. The defect stops the build, so the control is a fixture
// of its own.
const o = { "": 1, a: 2 };
observe("empty", String(o[""]));
observe("a", String(o.a));
done();
