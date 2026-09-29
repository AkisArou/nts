// A private method handed out as a value -- `get method() { return
// this.#method; }` -- evaluates an element default in its parameter pattern
// twice: `#m([[x] = init()])` called through the value with `[]` runs init()
// two times, where the language runs it once. Called directly it runs once.
// A plain parameter default and a whole-pattern default agree through the
// value, so it is an *element* default. Found by test262's {statements,
// expressions}/class/dstr/private-{gen-,}meth{,-dflt}-ary-ptrn-elem-ary-
// empty-init.js (8 files, initCount 2 where 1 is asserted), reproduced from
// the census's own layout (tooling/census/materialise262.ts). The control
// calls the same kind of method directly and differs in that only.
let throughValue = 0;
let direct = 0;
class C {
  #viaValue([[x] = (() => { throughValue += 1; return [7]; })()]: number[][]) { return x; }
  #viaCall([[y] = (() => { direct += 1; return [7]; })()]: number[][]) { return y; }
  get method() {
    return this.#viaValue;
  }
  callDirectly() {
    return this.#viaCall([]);
  }
}
const c = new C();
c.method([]);
c.callDirectly();
observe("through the value", String(throughValue));
observe("called directly", String(direct));
done();
