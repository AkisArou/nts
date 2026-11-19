// A module-scope initializer lowering refuses (`new Function`) is one module
// evaluation skips: `log("init")` never runs, where node prints it. That is a
// change to what evaluation runs, recorded beside its diagnostic
// (`Program::module_evaluation_cuts`), so a whole-program comparison refuses
// the program by name rather than reporting the missing line as a wrong answer.
function log(s: string): number {
  console.log(s);
  return 1;
}
const unused = log("init") + new Function("return 1")();
console.log("end");
