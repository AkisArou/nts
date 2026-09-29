// A wrong answer: `"\uDC00" > "\uD800"` is true -- strings compare by code
// unit (IsLessThan compares the sequences of code units), and 0xDC00 >
// 0xD800. The control, a-comparison-of-letters, compares ordinary code units
// and agrees. Found by test262's expressions/greater-than/S11.8.2_A4.12_T1.js
// and less-than/S11.8.1_A4.12_T1.js, e32be23f8.
observe("\\uDC00 > \\uD800", String("\uDC00" > "\uD800"));
done();
