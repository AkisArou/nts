// invalid HIR: `FellThrough { func: "Closure0#call", block: BlockId(0) }`.
// An arrow whose parameter is an array pattern, called with a *generator object*:
// the entry block of its body is left without a terminator. 248 test262 cases
// under test/language/**/dstr/ reach it. Only with a generator argument -- the
// same arrow called with an array lowers.
var iter = function* () {}();
var callCount = 0;
var f;
f = ([]) => {
  callCount = callCount + 1;
};
f(iter);
observe("callCount", String(callCount));
done();
