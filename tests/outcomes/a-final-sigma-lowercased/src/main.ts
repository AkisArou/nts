// Capital sigma lowercases to final sigma (U+03C2) at the end of a word and
// to U+03C3 elsewhere: SpecialCasing.txt's Final_Sigma condition. nts gives
// U+03C3 in both. Found by test262's String/prototype/toLowerCase/
// special_casing_conditional.js and Final_Sigma_U180E.js. The control puts
// a letter after the sigma, and differs in that only.
const code = (s: string) => Array.from(s).map((c) => (c.codePointAt(0) ?? 0).toString(16)).join(" ");
observe("final", code("A\u03A3".toLowerCase()));
observe("medial", code("A\u03A3B".toLowerCase()));
done();
