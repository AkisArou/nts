class C {
  static g() {
    return 45;
  }
  static g = this.g();
}
class D {
  static h() {
    return 45;
  }
  static g = this.h();
}
export function run() {
  return [
    ["method replaced", String(C.g)],
    ["field from another method", String(D.g)],
  ];
}
