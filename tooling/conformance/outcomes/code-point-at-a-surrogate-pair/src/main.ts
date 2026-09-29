// The control for code-point-at-a-lone-leading-surrogate: a leading surrogate
// followed by a trailing one, which combine to U+10000. Agrees with node.
// (Written as escapes on purpose: a tool once turned them into the raw
// character, which is a different program.)
observe("codePointAt", String("\uD800\uDC00".codePointAt(0)));
done();
