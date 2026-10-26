// Subject/control differ only in private versus public static getter keys.
const Subject = class {
  static get #value() { return 7; }
  static read() { return this.#value; }
};
const Control = class {
  static get value() { return 7; }
  static read() { return this.value; }
};
/** @param {number} n @returns {number} */
export function subject(n) { return Subject.read() + n; }
/** @param {number} n @returns {number} */
export function control(n) { return Control.read() + n; }
