// expect: a namespace
//
// `namespace` was ✅ in `typescript.md` on eleven characters of claim. It is
// not: every form refuses, and this fixture is the four of them in one file so
// the row cannot go green again without all four moving.
//
// A namespace holding a `const`, one holding an exported `function`, a nested
// namespace, and two declarations merged under one name. All four give
// `NTS1001 ..., a namespace`, from `describe_name` at `hir/lower.rs`.
//
// The name reaching `describe_name` at all is the finding: nothing has
// produced storage for the namespace object. `semantic-schema`'s `syntax.rs`
// has no module-declaration kind, so nothing walks a namespace body.
//
// **What this does NOT block is `declare module "c:..."`.** An ambient module
// declaration resolves through the ordinary import path and compiles today --
// that is how `libc.d.ts` is packaged. Modules resolve; namespaces need
// storage. Same upstream AST kind, opposite requirements.
namespace Shapes {
  export const sides = 3;
  export function area(r: number): number { return r * r; }
}

namespace Outer {
  export namespace Inner {
    export const v = 7;
  }
}

namespace Merged { export const x = 1; }
namespace Merged { export const y = 2; }

export function run(): number {
  return Shapes.sides + Shapes.area(2) + Outer.Inner.v + Merged.x + Merged.y;
}
