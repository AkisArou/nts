// `for...of` over a string yields code points, and a lone surrogate is one
// of them: "a\ud801b\ud801" yields four strings of length 1, the
// surrogates as 0xd801 (55297). nts yields eight, each surrogate as three
// U+FFFD. Found by test262's statements/for-of/string-astral-truncated.js.
// The control completes each surrogate into a pair and differs in that only;
// a pair is one value of length 2.
const lone: string[] = [];
for (const value of "a\ud801b\ud801") lone.push(String(value.length) + ":" + String(value.charCodeAt(0)));
const paired: string[] = [];
for (const value of "a\ud801\udc00b\ud801\udc00") paired.push(String(value.length) + ":" + String(value.charCodeAt(0)));
observe("lone", lone.join(","));
observe("paired", paired.join(","));
done();
