// Esprima-next 6.0.3, BSD-2-Clause; original notice in esprima.ts and ../LICENSE-jetstream.
// Strict TypeScript transcription of the source embedded in the pinned JetStream bundle.
// Ensure the condition is true, otherwise throw an error.
// This is only to have a better contract semantic, i.e. another safety net
// to catch a logic error. The condition shall be fulfilled in normal case.
// Do NOT use this to enforce a certain condition on any user input.

export function assert(condition: boolean, message: string): void {
    /* istanbul ignore if */
    if (!condition) {
        throw new Error('ASSERT: ' + message);
    }
}
