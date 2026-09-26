// `class Subclass extends Int8Array {}` makes instances that are both a Subclass
// and an Int8Array. nts builds a plain typed array -- `instanceof Subclass` is false,
// `instanceof Int8Array` true -- for every typed
// array: statements/class/subclass-builtins/subclass-{Int8,Uint8,Int16,Uint16,
// Int32,Uint32,Float32,Float64}Array.js, first reachable once the test262 stand-in's
// `assert` became callable (fc2ae51e2). No diagnostic. The control is a subclass of
// a class of our own.
class Mine {}
class SubMine extends Mine {}
const own = new SubMine();
observe("own subclass", String(own instanceof SubMine) + "," + String(own instanceof Mine));
class Sub8 extends Int8Array {}
const s8 = new Sub8();
observe("Int8Array subclass", String(s8 instanceof Sub8) + "," + String(s8 instanceof Int8Array));
class SubF64 extends Float64Array {}
const f64 = new SubF64();
observe("Float64Array subclass", String(f64 instanceof SubF64) + "," + String(f64 instanceof Float64Array));
done();
