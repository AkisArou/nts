
// `$DONE(error?)`, the asynchronous protocol's completion callback, appended
// by `project.ts` for a test that names it. Transcribed from
// `harness/doneprintHandle.js`: a falsy argument prints
// `Test262:AsyncTestComplete`, anything else `Test262:AsyncTestFailure:` and
// its name and message. The runner judges an async case by those lines, as
// INTERPRETING.md's `async` flag has it: complete only once the complete line
// is printed, failed on a `Test262:AsyncTestFailure:` line, and failed if no
// line comes -- a test that never calls `$DONE` does not pass by saying
// nothing. `attempt262.ts` reads them.
//
// The shipped handle reads `error.name` behind `'name' in error`; this asks
// `instanceof Error` instead, which lowers, and names a value that is no
// `Error` as the handle does (`Test262Error: ` and the value) in words rather
// than by `String(error)`, which does not lower on an unnarrowed object.
function $DONE(error?: unknown): void {
  if (!error) {
    console.log("Test262:AsyncTestComplete");
  } else if (error instanceof Test262Error) {
    console.log(`Test262:AsyncTestFailure:Test262Error: ${error.message}`);
  } else if (error instanceof Error) {
    console.log(`Test262:AsyncTestFailure:${error.name}: ${error.message}`);
  } else {
    console.log("Test262:AsyncTestFailure:Test262Error: a thrown value that is not an Error");
  }
}
