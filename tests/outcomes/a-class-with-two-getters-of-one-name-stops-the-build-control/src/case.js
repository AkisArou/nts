class C {
  get ["a"]() { return "second"; }
}
export function run() {
  return [["a", new C().a]];
}
