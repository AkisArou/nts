function target() { return typeof arguments === "object" ? 17 : 0; }
/** @param {number} n @returns {number} */
export function subject(n) { const bound = target.bind(null, n); return bound(); }
