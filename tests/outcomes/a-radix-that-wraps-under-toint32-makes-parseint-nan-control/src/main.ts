// Control for a-radix-that-wraps-under-toint32-makes-parseint-nan: the same strings with the radices ToInt32 gives, 16, 2 and 0.
observe("radix 16", String(parseInt("10", 16)));
observe("radix 2", String(parseInt("10", 2)));
observe("radix 0", String(parseInt("0x10", 0)));
done();
