// `emit-c` exits 0 and `cc` rejects the C: `incompatible type for argument 1 of
// 'nts_to_int32'`. `~` applied to an object value. Found by test262's
// expressions/bitwise-not/S11.4.8_A3_T5.js.
const o = {};
observe("~o", String(~o));
done();
