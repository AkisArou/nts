// expect: emit-c --napi -> lacks-addon "proc"
//
// A class instance exported as a value, one of whose fields has a refused
// initialiser. The wrapper declines it with a sentence about what kind of thing
// it is:
//
//     no wrapper for proc: is exported and is not a function this backend can name
//
// It is not about being a value. **A class instance exported as a value
// publishes**, with a scalar field, with an object field, as a named export and
// as a default. What it cannot do is carry a field whose initialiser was
// refused, and the message says nothing about that.
//
// # What it is standing in front of
//
//     process/src/main.ts:275   class Process
//                               readonly env = env;     <- imported from ./env.ts
//                               readonly pid = nts_process_pid();
//     process/src/main.ts:845   const process = new Process();
//     process/src/main.ts:850   export default process;
//
//     no wrapper for process: is exported and is not a function this backend can name
//     no wrapper for Process: the same
//     no wrapper for default: the same
//
// `process` publishes **nothing**, and against the compiled addon 75 of its 90
// failing test files stop at `underTest._fatalException is not a function` --
// the third largest concentration in the tree.
//
// # Four controls, and the fourth is the condition
//
//     export { proc }   fields: pid = 1                         publishes
//     export default    fields: pid = 1                         publishes
//     export { proc }   fields: env: Env = {…}, pid = 1         publishes
//     export { proc }   fields: env = <a refused module value>  declined
//
// So neither the export form, nor being an instance, nor holding an object
// decides it. A refused field initialiser does, and the diagnostic names the
// category of the export instead.
//
// The expectation is an absence -- `lacks-addon "proc"` -- because the wrapper's
// sentence is about the wrong thing and a fixture naming it would be guarding
// the misdirection rather than the defect.
//
// **It therefore reports `guard ok`, and that label is not what it means here.**
// An absence-form expectation reads as a guard holding, and what is holding is
// the defect. The semantics are still right: when `proc` starts crossing, the
// absence fails and the run asks for a person, which is the announcement wanted.
// Said plainly because "guard ok" beside a filing invites the reading that this
// one is already fixed.

const table: Map<string, string> = new Map();

class Process {
  readonly env = table;
  readonly pid = 1;

  cwd(): number {
    return this.pid;
  }
}

const proc = new Process();

export { proc };
