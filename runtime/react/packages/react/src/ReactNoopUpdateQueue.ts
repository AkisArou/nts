import { isDevelopment } from "shared/Build.ts";

// How a class instance schedules its updates. The reconciler gives each
// mounted instance its own; before mounting, and for classes constructed
// outside React, this no-op one warns instead.
export interface Updater {
  isMounted(publicInstance: object): boolean;
  enqueueSetState(publicInstance: object, partialState: unknown, callback: unknown, callerName: string): void;
  enqueueReplaceState(publicInstance: object, completeState: unknown, callback: unknown, callerName: string): void;
  enqueueForceUpdate(publicInstance: object, callback: unknown, callerName: string): void;
}

const didWarnStateUpdateForUnmountedComponent: { [warningKey: string]: boolean } = {};

function warnNoop(publicInstance: object, callerName: string): void {
  if (!isDevelopment) {
    return;
  }
  const constructor = (publicInstance as { constructor?: { displayName?: unknown; name?: unknown } }).constructor;
  const componentName = (constructor && (constructor.displayName || constructor.name)) || "ReactClass";
  const warningKey = `${componentName}.${callerName}`;
  if (didWarnStateUpdateForUnmountedComponent[warningKey]) {
    return;
  }
  console.error(
    "Can't call %s on a component that is not yet mounted. " +
      "This is a no-op, but it might indicate a bug in your application. " +
      "Instead, assign to `this.state` directly or define a `state = {};` " +
      "class property with the desired state in the %s component.",
    callerName,
    componentName,
  );
  didWarnStateUpdateForUnmountedComponent[warningKey] = true;
}

export const ReactNoopUpdateQueue: Updater = {
  isMounted() {
    return false;
  },
  enqueueForceUpdate(publicInstance) {
    warnNoop(publicInstance, "forceUpdate");
  },
  enqueueReplaceState(publicInstance) {
    warnNoop(publicInstance, "replaceState");
  },
  enqueueSetState(publicInstance) {
    warnNoop(publicInstance, "setState");
  },
};
