// run: check
// backend: jvm
//
// The control: the same two generator defaults, with the arrow bound by
// `const`, so its call is direct and neither generator's `call` is live to
// fill the signature: the JVM emits it and agrees with node.
let calls = 0;
const f = ([gen = function* () {}, xGen = function* x() {}]) => {
  calls = calls + 1;
};
f([]);

export function run(): number {
  return calls;
}
