// **Now a guard.** Fixed by 11013501 (ECMAScript Number::toString in Rust, and a
// literal's digits parsed as written rather than taken from the checker), and
// re-recorded as agreeing: anything else is REGRESSED. It guards the
// *declaration* side -- the name a numeric key gives a member -- and reads it back
// by a string, which no rounding touches. The *read* side, `o[0.9999999999999999]`
// by the numeric literal, is still refused and lives in
// tooling/conformance/blockers/a-numeric-key-read-by-a-literal-the-checker-rounds.
//
// Numeric computed keys whose property name the compiler can produce without an
// implementation of ECMAScript's Number::toString: integral values below 1e21,
// which JavaScript prints as plain digits and Rust's Display prints the same, and
// a literal whose spelling already *is* its canonical name.
//
//   [0x10]                 "16"                     hex -- vanishes today
//   [1e20]                 "100000000000000000000"  exponent spelling of an integer -- vanishes today
//   [9007199254740992]     "9007199254740992"       2^53, works today
//   [0.9999999999999999]   "0.9999999999999999"     a distinct double -- NOT "1", though tsgo's
//                                                   checker value is 1 -- works today
//
// The cause of the vanishing is a-numeric-computed-accessor-name's: the literal's
// raw text used as the name. After the compiler lane's fix every arm must appear.
// Split from the keys that need a real Number::toString
// (numeric-computed-keys-that-need-number-tostring), because one refused arm would
// make this whole program refused and hide the ones that work.
const o = {
  [0x10]() { return "0x10"; },
  [1e20]() { return "1e20"; },
  [9007199254740992]() { return "2^53"; },
  [0.9999999999999999]() { return "almost-one"; },
};
observe("16", o["16"]());
observe("1e20", o["100000000000000000000"]());
observe("2^53", o["9007199254740992"]());
observe("almost", o["0.9999999999999999"]());
observe("after", "reached");
done();
