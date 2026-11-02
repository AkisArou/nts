// parseInt and parseFloat skip leading white space and line terminators,
// including every Unicode space separator. nts skips ASCII white space, NBSP,
// U+FEFF, LF and CR, but not U+1680, U+2000-U+200A, U+202F, U+205F, U+3000,
// U+2028 or U+2029, and gives NaN on C, LLVM and the JVM, where Number() skips
// them. Found by the number-format-routes family.
observe("parseInt after U+3000", String(parseInt("\u3000-7", 10)));
observe("parseFloat after U+2028", String(parseFloat("\u20280.5")));
observe("parseInt after U+1680", String(parseInt("\u16807", 10)));
done();
