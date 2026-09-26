// A class field whose computed name is a hex numeric literal, `[0x10] = "f"`,
// defines the property "16". nts segfaults (SIGSEGV, no diagnostic); the decimal
// spelling `[16] = "f"` is the control. The accessor and method forms of the same
// key lose their reading statement instead -- a-numeric-computed-accessor-name --
// so one folding of numeric keys is behind all three. Found probing that fixture
// at the compiler lane's request.
class C {
  [0x10] = "f";
}
var c = new C();
observe("read", String(c["16"]));
observe("after", "reached");
done();
