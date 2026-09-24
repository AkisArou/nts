// The `Error.prepareStackTrace` to install while formatting a stack.
// `undefined` restores V8's default formatting; upstream forks this module in
// server builds where the default frame may be source mapped.

export type PrepareStackTrace = ((error: Error, stackTraces: NodeJS.CallSite[]) => unknown) | undefined;

export const DefaultPrepareStackTrace: PrepareStackTrace = undefined;

// `Error` with its V8 hook, which may be unset. Node's typings declare it
// as always present, but assigning `undefined` is how V8's default returns.
export const ErrorWithStackHook = Error as { prepareStackTrace?: PrepareStackTrace };

export default DefaultPrepareStackTrace;
