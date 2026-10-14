// expect: emit-c --napi -> publishes alpha
//
// FIXED, kept as a guard. The entry module is the one the tsconfig names.
//
// `hir::lower::public_api` decides whose exports the addon publishes, and until
// `files` was read it decided by asking which modules nothing imports. That is
// a guess, and this file is the shape it gets wrong: `main.ts` and `back.ts`
// import each other, so *both* are "imported", so neither is an entry and the
// addon publishes nothing at all -- no exports, and no declines either, because
// there is no export list to have an opinion about.
//
// That is not a hypothetical arrangement. `fs/src/utf8-stream.ts` imports
// `openSync`, `writeSync`, `mkdirSync` and `fsyncSync` from `fs/src/main.ts`,
// and `main.ts` re-exports `Utf8Stream` back. All 303 of `fs`'s exports went
// missing to it, silently: its addon.c had no publication section, not an empty
// one. Measured before and after, `fs` went from 0 published and 0 declined to
// 1 published and 105 declined.
//
// The tsconfig here carries `"files": ["src/main.ts"]`, which is what the
// twenty-two module tsconfigs now carry. `include` still governs the program --
// `back.ts` is still typechecked and still compiled -- so nothing is traded
// away for the entry selection.
//
// # The controls
//
// `alpha` is the expectation and it discriminates on its own: under the old
// rule this fixture published *nothing*, so a name appearing at all is the
// whole claim. `beta` is here so the guard covers a surface rather than a
// single lucky name, and it is the one that reaches into `back.ts`, so a
// change that published the entry by dropping its dependencies would fail on
// it rather than pass.
//
// `helper` must NOT be published: it is `back.ts`'s, and `back.ts` is a library
// module here however the cycle is read. A substring match cannot assert an
// absence, so this is stated rather than checked -- the check that would catch
// it is that publishing `back.ts` instead of `main.ts` loses `alpha`.
import { helper } from "./back.ts";

export function alpha(n: number): number {
  return n + 1;
}

export function beta(n: number): number {
  return helper(n) + alpha(n);
}
