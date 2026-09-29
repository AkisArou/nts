// `const [[] = init()] = []` must run init(): the element is missing, so the
// default is evaluated and then destructured by the empty pattern. nts never
// calls it. Found by test262's statements/{const,let,variable}/dstr/
// ary-ptrn-elem-ary-empty-init.js and the private-method twins, which were
// invalid HIR until the generator-expression change exposed them. The
// control names one element in the nested pattern, and differs in that only.
let emptyPattern = 0;
const [[] = (() => { emptyPattern += 1; return [] as number[]; })()] = [] as number[][];
let namedPattern = 0;
const [[x] = (() => { namedPattern += 1; return [7]; })()] = [] as number[][];
observe("empty", String(emptyPattern));
observe("named", String(namedPattern) + "/" + String(x));
done();
