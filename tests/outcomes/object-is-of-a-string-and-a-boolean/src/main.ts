// run: build
//
// `Object.is` of a string and a boolean answers false, as node prints. nts
// emits the string comparison, `nts_string_eq`, and passes the boolean as its
// second argument, so the C compiler rejects the program it emits ("makes
// pointer from integer without a cast"). From test262 built-ins/Object/is
// not-same-value-x-y-string (census of 2026-11-06 on pin e0395d27506b). The
// control, object-is-of-a-string-and-a-boolean-control, compares two strings
// and agrees. The defect stops the build, so the control is a fixture of its
// own.
observe("string and boolean", String(Object.is("", true)));
done();
