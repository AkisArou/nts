// run: build
//
// `s["length"]` and `s["1"]` are strict TypeScript: the checker resolves the
// first key to the `length` property and the second to the numeric index
// signature, and node prints 11 and "e". nts lowers both as an index into the
// string and passes the key text to the runtime's index helper (`nts_str_at`),
// which takes a number, so the C compiler rejects the program nts emits
// ("incompatible type for argument 2 of 'nts_str_at'"). JavaScript reaches the
// same call with any string key: test262 built-ins/String/15.5.5.5.2-1-2 and
// 15.5.5.5.2-3-2 (`s["foo"]`, which reads undefined) stop there in the census
// of 2026-11-06 on pin e0395d27506b. The control,
// a-string-indexed-by-a-string-literal-key-control, reads the same values as
// `s.length` and `s[1]` and agrees. The defect stops the build, so the control
// is a fixture of its own.
const s: string = "hello world";
observe("length", String(s["length"]));
observe("one", s["1"]);
done();
