class C {
  static f = "test";
  static f = this.f + "262";
}
export function run() {
  return [["defined twice", String(C.f)]];
}
