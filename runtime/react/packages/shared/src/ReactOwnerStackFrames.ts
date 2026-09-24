import { DefaultPrepareStackTrace, ErrorWithStackHook } from "./DefaultPrepareStackTrace.ts";

// Formats the stack of an element's creation (its owner stack) into the
// frames between the JSX call and React's own `react_stack_bottom_frame`.
export function formatOwnerStack(error: Error): string {
  const prevPrepareStackTrace = ErrorWithStackHook.prepareStackTrace;
  ErrorWithStackHook.prepareStackTrace = DefaultPrepareStackTrace;
  let stack = error.stack ?? "";
  ErrorWithStackHook.prepareStackTrace = prevPrepareStackTrace;
  if (stack.startsWith("Error: react-stack-top-frame\n")) {
    // V8's default formatting prefixes with the error message which we
    // don't want/need.
    stack = stack.slice(29);
  }
  let idx = stack.indexOf("\n");
  if (idx !== -1) {
    // Pop the JSX frame.
    stack = stack.slice(idx + 1);
  }
  idx = stack.indexOf("react_stack_bottom_frame");
  if (idx !== -1) {
    idx = stack.lastIndexOf("\n", idx);
  }
  if (idx !== -1) {
    // Cut off everything after the bottom frame since it'll be internals.
    stack = stack.slice(0, idx);
  } else {
    // We didn't find any internal callsite out to user space.
    // This means that this was called outside an owner or the owner is fully internal.
    // To keep things light we exclude the entire trace in this case.
    return "";
  }
  return stack;
}
