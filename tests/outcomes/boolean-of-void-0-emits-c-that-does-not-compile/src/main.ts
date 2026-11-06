// run: build
//
// `void 0` is undefined, so `Boolean(void 0)` is false, as node prints. nts
// emits C that uses a temporary it never declares and passes the void
// expression itself as the argument, so the C compiler rejects the program
// ("'__nts_v1' undeclared"; "invalid use of void expression"). test262
// built-ins/Boolean/S15.6.1.1_A1_T4 stops there in the census of 2026-11-06 on
// pin e0395d27506b. The control,
// boolean-of-void-0-emits-c-that-does-not-compile-control, passes `undefined`
// and agrees. The defect stops the build, so the control is a fixture of its
// own.
observe("void 0", String(Boolean(void 0)));
done();
