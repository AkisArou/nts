// **Now a guard.** Fixed by 11013501 (ECMAScript Number::toString in Rust, and a
// literal's digits parsed as written rather than taken from the checker), and
// re-recorded as agreeing: anything else is REGRESSED. It guards the
// *declaration* side -- the name a numeric key gives a member -- and reads it back
// by a string, which no rounding touches. The *read* side, `o[0.9999999999999999]`
// by the numeric literal, is still refused and lives in
// tooling/conformance/blockers/a-numeric-key-read-by-a-literal-the-checker-rounds.
//
// A class field whose computed name is a hex numeric literal, `[0x10] = "f"`,
// defines the property "16". nts segfaults (SIGSEGV, no diagnostic); the decimal
// spelling `[16] = "f"` is the control. The accessor and method forms of the same
// key lose their reading statement instead -- a-numeric-computed-accessor-name --
// so one folding of numeric keys is behind all three. Found probing that fixture
// at the compiler lane's request.
//
// **The cause (diagnosed by the compiler lane):** a numeric literal carries its raw
// source text (ast.rs, rightly, for values), and `literal_name` returns that text
// for a computed *name* -- `"0x10"` -- while every read of the member looks up
// ECMAScript's ToString of the value, `"16"`. One name in the layout, another in
// the lookup: an accessor or method read finds nothing and its statement is
// dropped, a field reaches a slot that is not there. Formatting cases the fix must
// also get right are pinned in numeric-computed-keys-where-formatting-can-disagree.
class C {
  [0x10] = "f";
}
var c = new C();
observe("read", String(c["16"]));
observe("after", "reached");
done();
