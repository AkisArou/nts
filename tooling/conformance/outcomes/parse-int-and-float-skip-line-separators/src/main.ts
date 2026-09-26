// parseInt and parseFloat skip leading *white space and line terminators*, and
// U+2028 and U+2029 are line terminators. nts answers NaN where node answers 1 and
// 1.1. No diagnostic. Found by the first test/built-ins census:
// parseInt/S15.1.2.2_A2_T8/T9 and parseFloat/S15.1.2.3_A2_T8/T9.
observe("parseInt LS", String(parseInt(" 1")));
observe("parseInt PS", String(parseInt(" 1")));
observe("parseFloat LS", String(parseFloat(" 1.1")));
observe("parseFloat PS", String(parseFloat(" 1.1")));
observe("parseInt tab (control)", String(parseInt("\t1")));
done();
