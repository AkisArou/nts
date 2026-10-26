// One selected read is inside an arrow; its control reads the same member directly.
const Closed = class {
  #value = 7;
  get #get() { return this.#value; }
  read() { const f = () => this.#get; return f(); }
  direct() { return this.#get; }
};
/** @param {number} n @returns {number} */
export function subject(n) { return new Closed().read() + n; }
/** @param {number} n @returns {number} */
export function control(n) { return new Closed().direct() + n; }
