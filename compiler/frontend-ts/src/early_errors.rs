/// Checker codes that are ECMAScript early errors, reported for a plain-JS file
/// although TypeScript's own `plainJSErrors` list leaves them out.
///
/// A JavaScript file with `checkJs` unset is *plain JS*: TypeScript checks it fully and
/// keeps only the errors TypeScript is sure JavaScript has. test262 requires more
/// of them -- `f() = 1` is a `SyntaxError` -- and the checker computes them and
/// drops them. These are the ones **no valid test262 program draws**: measured by
/// `tooling/census/semantic-codes.ts` over every in-lane file of all five
/// directories, laid out as the census lays them out with `checkJs: true` --
/// 42,909 positive and 4,595 negative files -- each code here drawn by 0
/// positives and at least one negative, in script and module code alike
/// (2026-10-03, `~/.cache/nts-semantic-codes/all-by-goal.json`):
///
/// ```text
///   TS2364  0 / 248     TS2357  0 / 12     TS1108  0 / 12     TS2487  0 / 5
///   TS2652  0 / 4       TS2323  0 / 2      TS2661  0 / 1      TS2701  0 / 1
/// ```
///
/// **A code joins only on that measurement**, because rejecting a program over a
/// code valid JavaScript draws is a regression on every file that draws it:
/// TS2300 (duplicate identifier) is the early error for duplicate exports, and
/// valid module code draws it 16 times.
pub(crate) const EARLY_ERRORS: [i32; 8] = [2364, 2357, 1108, 2487, 2652, 2323, 2661, 2701];
