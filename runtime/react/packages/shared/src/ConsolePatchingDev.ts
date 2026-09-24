// Helpers to patch console.logs to avoid logging during side-effect free
// replaying on render function. This currently only patches the object
// lazily which won't cover if the log function was extracted eagerly.
// We could also eagerly patch the method.
//
// JS object model: this replaces console methods with property descriptors,
// as upstream does. Development only.

import { isDevelopment } from "shared/Build.ts";

type ConsoleMethod = (...args: unknown[]) => void;

let disabledDepth = 0;
let prevLog: ConsoleMethod;
let prevInfo: ConsoleMethod;
let prevWarn: ConsoleMethod;
let prevError: ConsoleMethod;
let prevGroup: ConsoleMethod;
let prevGroupCollapsed: ConsoleMethod;
let prevGroupEnd: ConsoleMethod;

// The name matters: the mock scheduler recognises `disabledLog` and ignores
// values logged during a replay.
function disabledLog(): void {}
(disabledLog as { __reactDisabledLog?: boolean }).__reactDisabledLog = true;

export function disableLogs(): void {
  if (isDevelopment) {
    if (disabledDepth === 0) {
      prevLog = console.log;
      prevInfo = console.info;
      prevWarn = console.warn;
      prevError = console.error;
      prevGroup = console.group;
      prevGroupCollapsed = console.groupCollapsed;
      prevGroupEnd = console.groupEnd;
      // https://github.com/facebook/react/issues/19099
      const props = {
        configurable: true,
        enumerable: true,
        value: disabledLog,
        writable: true,
      };
      Object.defineProperties(console, {
        info: props,
        log: props,
        warn: props,
        error: props,
        group: props,
        groupCollapsed: props,
        groupEnd: props,
      });
    }
    disabledDepth++;
  }
}

export function reenableLogs(): void {
  if (isDevelopment) {
    disabledDepth--;
    if (disabledDepth === 0) {
      const props = {
        configurable: true,
        enumerable: true,
        writable: true,
      };
      Object.defineProperties(console, {
        log: { ...props, value: prevLog },
        info: { ...props, value: prevInfo },
        warn: { ...props, value: prevWarn },
        error: { ...props, value: prevError },
        group: { ...props, value: prevGroup },
        groupCollapsed: { ...props, value: prevGroupCollapsed },
        groupEnd: { ...props, value: prevGroupEnd },
      });
    }
    if (disabledDepth < 0) {
      console.error("disabledDepth fell below zero. " + "This is a bug in React. Please file an issue.");
    }
  }
}
