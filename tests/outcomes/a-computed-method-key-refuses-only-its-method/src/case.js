// A method whose name the program computes, `[key()]() {}`, has its key
// evaluated once, when the class is defined. Here the method is refused by
// name -- "a member whose name the program computes" -- but only the
// method: the function that defines the class compiles without it and runs,
// and the key is never evaluated. node: 1 for each arm; nts: 0, beside a
// refusal that names a member nothing in the run reached.
//
// The control is `constantKey`: the same class with the key written as a
// string literal, which names one member and agrees.
//
// The field form is tests/outcomes/a-computed-field-key-is-never-evaluated,
// where not even the member is refused. JS, as that one is: typed
// TypeScript refuses a computed member key that is not a literal (TS1166 for
// a field; a method is allowed, and is kept JS to stay one program shape).

let logged = 0;

/** @param {string} key @returns {string} */
function log(key) {
  logged = logged + 1;
  return key;
}

/** @param {number} n @returns {number} */
export function method(n) {
  logged = 0;
  class K {
    [log("m")]() {
      return 1;
    }
  }
  return logged + (n & 0) + (K === K ? 0 : 0);
}

/** @param {number} n @returns {number} */
export function staticGetter(n) {
  logged = 0;
  class K {
    static get [log("g")]() {
      return 1;
    }
  }
  return logged + (n & 0) + (K === K ? 0 : 0);
}

/** @param {number} n @returns {number} */
export function constantKey(n) {
  logged = 0;
  class K {
    ["m"]() {
      return log("v");
    }
  }
  return logged + (n & 0) + (K === K ? 0 : 0);
}
