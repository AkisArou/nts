class C {
  static f = "test";
  static e = this.f + "262";
}
export function run() {
  return [["defined once each", String(C.e)]];
}
