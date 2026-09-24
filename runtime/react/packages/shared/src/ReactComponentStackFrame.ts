// Component stack frames: one line per component, formatted like the host
// VM's own stack frames so that component stacks and JavaScript stacks read
// the same way.
//
// Upstream reads `ReactSharedInternals` directly. This package cannot import
// `react` (that would be a circular project reference), so the functions
// that must clear the hooks dispatcher take the internals as their last
// argument.

import { isDevelopment } from "shared/Build.ts";
import { disableLogs, reenableLogs } from "./ConsolePatchingDev.ts";
import { DefaultPrepareStackTrace, ErrorWithStackHook } from "./DefaultPrepareStackTrace.ts";
import { formatOwnerStack } from "./ReactOwnerStackFrames.ts";

// The part of `ReactSharedInternals` a frame needs: the hooks dispatcher,
// cleared while a component is called outside a render.
export interface DispatcherHolder {
  H: unknown;
}

// A component function or class, as React describes it.
export type ComponentFunction = Function & {
  displayName?: unknown;
  prototype?: object;
};

let prefix: string | undefined;
let suffix: string | undefined;

export function describeBuiltInComponentFrame(name: string): string {
  if (prefix === undefined) {
    // Extract the VM specific prefix used by each line.
    try {
      throw Error();
    } catch (x) {
      const stack = (x as Error).stack ?? "";
      const match = stack.trim().match(/\n( *(at )?)/);
      prefix = (match && match[1]) || "";
      suffix =
        stack.indexOf("\n    at") > -1
          ? // V8
            " (<anonymous>)"
          : // JSC/Spidermonkey
            stack.indexOf("@") > -1
            ? "@unknown:0:0"
            : // Other
              "";
    }
  }
  // We use the prefix to ensure our stacks line up with native stack frames.
  return "\n" + prefix + name + suffix;
}

export function describeDebugInfoFrame(name: string, env: string | null | undefined, location: Error | null | undefined): string {
  if (location != null) {
    // If we have a location, it's the child's owner stack. Treat the bottom most frame as
    // the location of this function.
    const childStack = formatOwnerStack(location);
    const idx = childStack.lastIndexOf("\n");
    const lastLine = idx === -1 ? childStack : childStack.slice(idx + 1);
    if (lastLine.indexOf(name) !== -1) {
      // For async stacks it's possible we don't have the owner on it. As a precaution only
      // use this frame if it has the name of the function in it.
      return "\n" + lastLine;
    }
  }

  return describeBuiltInComponentFrame(name + (env ? " [" + env + "]" : ""));
}

let reentry = false;
const componentFrameCache: WeakMap<Function, string> = new WeakMap<Function, string>();

function displayNameOf(fn: ComponentFunction): string {
  if (fn.displayName) {
    return String(fn.displayName);
  }
  return fn.name;
}

/**
 * Leverages native browser/VM stack frames to get proper details (e.g.
 * filename, line + col number) for a single component in a component stack. We
 * do this by:
 *   (1) throwing and catching an error in the function - this will be our
 *       control error.
 *   (2) calling the component which will eventually throw an error that we'll
 *       catch - this will be our sample error.
 *   (3) diffing the control and sample error stacks to find the stack frame
 *       which represents our component.
 *
 * JS object model: this constructs or calls the component with a throwing
 * `props` setter on a fake prototype, as upstream does.
 */
export function describeNativeComponentFrame(
  fn: ComponentFunction | null | undefined,
  construct: boolean,
  internals: DispatcherHolder,
): string {
  // If something asked for a stack inside a fake render, it should get ignored.
  if (!fn || reentry) {
    return "";
  }

  if (isDevelopment) {
    const frame = componentFrameCache.get(fn);
    if (frame !== undefined) {
      return frame;
    }
  }

  reentry = true;
  const previousPrepareStackTrace = ErrorWithStackHook.prepareStackTrace;
  ErrorWithStackHook.prepareStackTrace = DefaultPrepareStackTrace;
  let previousDispatcher: unknown = null;

  if (isDevelopment) {
    previousDispatcher = internals.H;
    // Set the dispatcher in DEV because this might be call in the render function
    // for warnings.
    internals.H = null;
    disableLogs();
  }
  try {
    /**
     * Finding a common stack frame between sample and control errors can be
     * tricky given the different types and levels of stack trace truncation from
     * different JS VMs. So instead we'll attempt to control what that common
     * frame should be through this object method:
     * Having both the sample and control errors be in the function under the
     * `DescribeNativeComponentFrameRoot` property, + setting the `name` and
     * `displayName` properties of the function ensures that a stack
     * frame exists that has the method name `DescribeNativeComponentFrameRoot` in
     * it for both control and sample stacks.
     */
    const RunInRootFrame = {
      DetermineComponentFrameRoot(): [string | null, string | null] {
        let control: unknown;
        try {
          // This should throw.
          if (construct) {
            // Something should be setting the props in the constructor.
            const Fake = function (): void {
              throw Error();
            };
            Object.defineProperty(Fake.prototype, "props", {
              set: function () {
                // We use a throwing setter instead of frozen or non-writable props
                // because that won't throw in a non-strict mode function.
                throw Error();
              },
            });
            // We construct a different control for this case to include any extra
            // frames added by the construct call.
            try {
              Reflect.construct(Fake, []);
            } catch (x) {
              control = x;
            }
            Reflect.construct(fn, [], Fake);
          } else {
            try {
              throw Error();
            } catch (x) {
              control = x;
            }
            // TODO(luna): This will currently only throw if the function component
            // tries to access React/ReactDOM/props. We should probably make this throw
            // in simple components too
            const maybePromise: unknown = Reflect.apply(fn, undefined, []);

            // If the function component returns a promise, it's likely an async
            // component, which we don't yet support. Attach a noop catch handler to
            // silence the error.
            // TODO: Implement component stacks for async client components?
            if (maybePromise && typeof (maybePromise as { catch?: unknown }).catch === "function") {
              (maybePromise as Promise<unknown>).catch(() => {});
            }
          }
        } catch (sample) {
          // This is inlined manually because closure doesn't do it for us.
          if (sample && control && typeof (sample as Error).stack === "string") {
            return [(sample as Error).stack!, (control as Error).stack ?? null];
          }
        }
        return [null, null];
      },
    };
    (RunInRootFrame.DetermineComponentFrameRoot as { displayName?: string }).displayName = "DetermineComponentFrameRoot";
    const namePropDescriptor = Object.getOwnPropertyDescriptor(RunInRootFrame.DetermineComponentFrameRoot, "name");
    // Before ES6, the `name` property was not configurable.
    if (namePropDescriptor && namePropDescriptor.configurable) {
      // V8 utilizes a function's `name` property when generating a stack trace.
      Object.defineProperty(
        RunInRootFrame.DetermineComponentFrameRoot,
        // Configurable properties can be updated even if its writable descriptor
        // is set to `false`.
        "name",
        { value: "DetermineComponentFrameRoot" },
      );
    }

    const [sampleStack, controlStack] = RunInRootFrame.DetermineComponentFrameRoot();
    if (sampleStack && controlStack) {
      // This extracts the first frame from the sample that isn't also in the control.
      // Skipping one frame that we assume is the frame that calls the two.
      const sampleLines = sampleStack.split("\n");
      const controlLines = controlStack.split("\n");
      let s = 0;
      let c = 0;
      while (s < sampleLines.length && !sampleLines[s]!.includes("DetermineComponentFrameRoot")) {
        s++;
      }
      while (c < controlLines.length && !controlLines[c]!.includes("DetermineComponentFrameRoot")) {
        c++;
      }
      // We couldn't find our intentionally injected common root frame, attempt
      // to find another common root frame by search from the bottom of the
      // control stack...
      if (s === sampleLines.length || c === controlLines.length) {
        s = sampleLines.length - 1;
        c = controlLines.length - 1;
        while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) {
          // We expect at least one stack frame to be shared.
          // Typically this will be the root most one. However, stack frames may be
          // cut off due to maximum stack limits. In this case, one maybe cut off
          // earlier than the other. We assume that the sample is longer or the same
          // and there for cut off earlier. So we should find the root most frame in
          // the sample somewhere in the control.
          c--;
        }
      }
      for (; s >= 1 && c >= 0; s--, c--) {
        // Next we find the first one that isn't the same which should be the
        // frame that called our sample function and the control.
        if (sampleLines[s] !== controlLines[c]) {
          // In V8, the first line is describing the message but other VMs don't.
          // If we're about to return the first line, and the control is also on the same
          // line, that's a pretty good indicator that our sample threw at same line as
          // the control. I.e. before we entered the sample frame. So we ignore this result.
          // This can happen if you passed a class to function component, or non-function.
          if (s !== 1 || c !== 1) {
            do {
              s--;
              c--;
              // We may still have similar intermediate frames from the construct call.
              // The next one that isn't the same should be our match though.
              if (c < 0 || sampleLines[s] !== controlLines[c]) {
                // V8 adds a "new" prefix for native classes. Let's remove it to make it prettier.
                let frame = "\n" + sampleLines[s]!.replace(" at new ", " at ");

                // If our component frame is labeled "<anonymous>"
                // but we have a user-provided "displayName"
                // splice it in to make the stack more readable.
                if (fn.displayName && frame.includes("<anonymous>")) {
                  frame = frame.replace("<anonymous>", String(fn.displayName));
                }

                if (isDevelopment) {
                  if (typeof fn === "function") {
                    componentFrameCache.set(fn, frame);
                  }
                }
                // Return the line we found.
                return frame;
              }
            } while (s >= 1 && c >= 0);
          }
          break;
        }
      }
    }
  } finally {
    reentry = false;
    if (isDevelopment) {
      internals.H = previousDispatcher;
      reenableLogs();
    }
    ErrorWithStackHook.prepareStackTrace = previousPrepareStackTrace;
  }
  // Fallback to just using the name if we couldn't make it throw.
  const name = fn ? displayNameOf(fn) : "";
  const syntheticFrame = name ? describeBuiltInComponentFrame(name) : "";
  if (isDevelopment) {
    if (typeof fn === "function") {
      componentFrameCache.set(fn, syntheticFrame);
    }
  }
  return syntheticFrame;
}

export function describeClassComponentFrame(ctor: ComponentFunction, internals: DispatcherHolder): string {
  return describeNativeComponentFrame(ctor, true, internals);
}

export function describeFunctionComponentFrame(fn: ComponentFunction, internals: DispatcherHolder): string {
  return describeNativeComponentFrame(fn, false, internals);
}
