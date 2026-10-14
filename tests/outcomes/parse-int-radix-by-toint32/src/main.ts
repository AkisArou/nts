// parseInt's radix goes through ToInt32: Infinity becomes 0 (so radix 10), and
// 4294967298 becomes 2. nts answers otherwise. No diagnostic. Found by the first
// test/built-ins census: parseInt/S15.1.2.2_A3.2_T1 and _T3.
observe("radix Infinity", String(parseInt("11", Number.POSITIVE_INFINITY)));
observe("radix 2^32+2", String(parseInt("11", 4294967298)));
observe("radix 2 (control)", String(parseInt("11", 2)));
done();
