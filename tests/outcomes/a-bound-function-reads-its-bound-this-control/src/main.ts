// run: build
//
// The control for a-bound-function-reads-its-bound-this: the same receiver
// passed with `call` instead of through `bind`. It answers true, as node does.
const o = {};
function isO(this: unknown): boolean { return this === o; }
observe("bound", String(isO.call(o)));
done();
