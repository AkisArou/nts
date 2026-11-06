class C {
  static f = "test";
  static f = this.f + "262";
}
/** @param {number} n @returns {string} */
export function definedTwice(n) {
  return C.f + String(n & 0);
}
