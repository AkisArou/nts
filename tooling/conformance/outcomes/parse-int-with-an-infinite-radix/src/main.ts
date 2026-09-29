// A wrong answer: `parseInt("11", Infinity)` is 11 -- the radix is
// ToInt32'd, and ToInt32(Infinity) is 0, which means radix 10. The control,
// parse-int-with-radix-ten, passes 10 and agrees. Found by test262's
// built-ins/parseInt/S15.1.2.2_A3.2_T1.js (Infinity) and A3.2_T3
// (4294967298, whose ToInt32 is 2), e32be23f8.
observe("parseInt(11, Infinity)", String(parseInt("11", Number.POSITIVE_INFINITY)));
done();
