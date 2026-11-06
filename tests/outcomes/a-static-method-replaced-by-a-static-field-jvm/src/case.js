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
/** @param {number} n @returns {string} */
export function methodReplaced(n) {
  return String(C.g) + String(n & 0);
}
/** @param {number} n @returns {string} */
export function fieldFromAnotherMethod(n) {
  return String(D.g) + String(n & 0);
}
