// **A top-level call to a function lowering refuses is cut out of the
// program, and the program runs without it.** `driven` is refused (NTS1001, a
// `yield` of nothing), `main` with it (NTS1003). `excise_from_initializer` then
// removes the `main()` statement from the module's evaluation, and what is left
// compiles, links, runs and exits 0. nts logs `before;after;` where node logs
// `before;main ran 1;after;`.
//
// Found by the React lane (2026-09-27, `probes/capture-narrowed` and
// `capture-module-scope`, both GTK apps whose refused `main` "printed
// nothing"), reduced here without GTK. The refusal lines are printed at build
// time. The artefact carries no trace of them, and neither does
// `nts refusals`, which lists `main` and `driven` but not the initializer that
// lost a statement. Plain `nts hir` has `call main()` in `module#init`;
// `hir --prepared` does not.
//
// The control, measured with this record, differs in one thing: `driven`
// yields a value (`yield 1`), which lowers. That program agrees
// (`before;main ran 1;after;`).
function* driven(): Generator<undefined, void, unknown> {
  yield;
}

let log = "";

function main(): void {
  let n = 0;
  for (const _ of driven()) n += 1;
  log += `main ran ${n};`;
}

log += "before;";
main();
log += "after;";
observe("what the top level did", log);
done();
