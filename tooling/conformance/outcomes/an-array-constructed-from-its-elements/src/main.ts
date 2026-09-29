// A wrong answer: `new Array(0, 1, 2, 3)` has length 4 and those elements --
// with more than one argument, the Array constructor makes an array of its
// arguments (Array ( ...values ), "numberOfArgs >= 2"). nts makes an empty
// one, so `join()` is "" and so is `join(",")`. The control,
// an-array-literal-of-the-same-elements, writes the literal and agrees. Found
// by test262's built-ins/Array/prototype/join/S15.4.4.5_A1.2_T1.js and three
// siblings, e32be23f8 -- first read as the join's default separator, until a
// control with the separator written out was wrong the same way.
const numbers = new Array(0, 1, 2, 3);
observe("length", String(numbers.length));
observe("join", numbers.join(","));
done();
