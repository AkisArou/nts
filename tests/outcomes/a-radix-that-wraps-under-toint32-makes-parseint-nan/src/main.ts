// parseInt converts its radix with ToInt32, so 2^32 + 16 is radix 16, -2^32 + 2
// is radix 2, and Infinity is 0, which reads "0x" as hexadecimal. nts gives
// NaN for each on C, LLVM and the JVM. Found by the number-format-routes family.
observe("radix 2^32+16", String(parseInt("10", 4294967312)));
observe("radix -2^32+2", String(parseInt("10", -4294967294)));
observe("radix Infinity", String(parseInt("0x10", Infinity)));
done();
