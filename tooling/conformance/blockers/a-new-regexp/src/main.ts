// expect: NTS1001 a `new` of unrepresentable type (`RegExp`) is not supported by this lowering yet
//
// `new RegExp(searchentry.text, "i")`, as the Search corpus port
// filters its list. There is no representation for a RegExp value yet.
// Measured with the compiler built from main d753577a6 (this tree).
//
// Control beside it, which must stay clean: the same case-insensitive
// containment written with string methods, which is how the port reads
// until this lands.
export function demo(text: string): boolean {
  const re = new RegExp(text, "i");
  return re.test("abc");
}

export function control(text: string): boolean {
  return "abc".includes(text);
}
