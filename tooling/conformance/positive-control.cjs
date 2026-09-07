// A subject the compiled-addon axis should score `green`.
//
// That axis has never produced a non-degenerate pass, so until this existed
// `sweep.mjs --addons` had never printed `green` and `--mutate-addon` had only
// ever been run against passes that *were* degenerate. Both branches were
// unexercised code inside a checking tool, which is the category this project
// keeps finding defects in.
//
// This is not a compiled artifact and does not pretend to be one. It is the
// module's own TypeScript presented through the `--addon` path, so the
// instrument is handed a subject whose answers are known good:
//
//   node tooling/conformance/run.mjs --module punycode \
//        --addon tooling/conformance/positive-control.cjs
//        -> 1 passed                     (the pass path works)
//
//   ... the same, plus --mutate-addon
//        -> 0 passed                     (a real pass is not called degenerate)
//
// The first says a zero on that axis is the compiler and not the harness. The
// second is the false-positive check on the mutation detector: it had only
// been shown to fire when it should, never to stay quiet when it should.
//
// `punycode` because it is the smallest module here and needs no siblings.
const { join } = require("node:path");
const ROOT = join(__dirname, "../..");
require(join(ROOT, "runtime/node/punycode/bindings.node.mjs"));
module.exports = require(join(ROOT, "runtime/node/punycode/src/main.ts"));
