class C {
  static f = "test";
  static e = this.f + "262";
}
/** @param {number} n @returns {string} */
export function definedOnceEach(n) {
  return C.e + String(n & 0);
}
