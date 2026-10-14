// A guard, not a defect: `[1e-7]` names the property "1e-7", and nts gets it right
// today because the literal's spelling *is* ECMAScript's name for the value.
//
// It is separate from numeric-computed-keys-that-need-number-tostring on purpose.
// A fix for the numeric-key bug that judged "the text is canonical" by Rust's
// reprint (0.0000001) would turn this into a refusal -- and inside that fixture a
// refusal reads as REFUSES NOW, which passes. Here it was recorded as agreeing, so
// anything else is REGRESSED, which fails.
const o = {
  [1e-7]() { return "1e-7"; },
};
observe("1e-7", o["1e-7"]());
done();
