// A tool's exit status is its verdict, and its report is the reader's
// evidence for it. `process.exit()` ends the process at once, but writes to a
// pipe are asynchronous: a report longer than the pipe holds loses its tail,
// verdict line included. The gate reads every step through a pipe, and the
// integrity-runtime step's log kept only its first two lines while its status
// said PASS.
//
// A tool ends with `exitAfterOutput(verdict)` instead: the status is set at
// once, and the process exits only after stdout and stderr have taken every
// write made before it.
export function exitAfterOutput(code: number): void {
  process.exitCode = code;
  let open = 2;
  const flushed = (): void => {
    open -= 1;
    if (open === 0) process.exit(code);
  };
  process.stdout.write("", flushed);
  process.stderr.write("", flushed);
}
