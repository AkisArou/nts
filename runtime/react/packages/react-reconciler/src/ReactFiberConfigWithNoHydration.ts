// Renderers that don't support hydration
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { Container, HostContext, HydratableInstance, Instance, Props, TextInstance, Type } from "react-reconciler/ReactFiberConfig.ts";

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support hydration. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export type ActivityInstance = unknown;
export type SuspenseInstance = unknown;
export const supportsHydration: boolean = false;
export const isSuspenseInstancePending: (instance: SuspenseInstance) => boolean = shim;
export const isSuspenseInstanceFallback: (instance: SuspenseInstance) => boolean = shim;
export const getSuspenseInstanceFallbackErrorDetails: (instance: SuspenseInstance) => { digest?: string; message?: string; stack?: string; componentStack?: string; } = shim;
export const registerSuspenseInstanceRetry: (instance: SuspenseInstance, callback: () => void) => void = shim;
export const canHydrateFormStateMarker: (instance: HydratableInstance, inRootOrSingleton: boolean) => unknown = shim;
export const isFormStateMarkerMatching: (markerInstance: unknown) => boolean = shim;
export const getNextHydratableSibling: (instance: HydratableInstance) => HydratableInstance | null = shim;
export const getNextHydratableSiblingAfterSingleton: (type: Type, fallbackInstance: HydratableInstance) => HydratableInstance | null = shim;
export const getFirstHydratableChild: (parentInstance: Instance) => HydratableInstance | null = shim;
export const getFirstHydratableChildWithinContainer: (parentContainer: Container) => HydratableInstance | null = shim;
export const getFirstHydratableChildWithinActivityInstance: (parentInstance: ActivityInstance) => HydratableInstance | null = shim;
export const getFirstHydratableChildWithinSuspenseInstance: (parentInstance: SuspenseInstance) => HydratableInstance | null = shim;
export const getFirstHydratableChildWithinSingleton: (type: Type, singletonInstance: Instance, currentHydratableInstance: HydratableInstance | null) => HydratableInstance | null = shim;
export const canHydrateInstance: (instance: HydratableInstance, type: Type, props: Props, inRootOrSingleton: boolean) => Instance | null = shim;
export const canHydrateTextInstance: (instance: HydratableInstance, text: string, inRootOrSingleton: boolean) => TextInstance | null = shim;
export const canHydrateActivityInstance: (instance: HydratableInstance, inRootOrSingleton: boolean) => ActivityInstance | null = shim;
export const canHydrateSuspenseInstance: (instance: HydratableInstance, inRootOrSingleton: boolean) => SuspenseInstance | null = shim;
export const hydrateInstance: (instance: Instance, type: Type, props: Props, hostContext: HostContext, internalInstanceHandle: object) => boolean = shim;
export const hydrateTextInstance: (textInstance: TextInstance, text: string, internalInstanceHandle: object, parentInstanceProps: Props | null) => boolean = shim;
export const hydrateActivityInstance: (activityInstance: ActivityInstance, internalInstanceHandle: object) => void = shim;
export const hydrateSuspenseInstance: (suspenseInstance: SuspenseInstance, internalInstanceHandle: object) => void = shim;
export const getNextHydratableInstanceAfterActivityInstance: (activityInstance: ActivityInstance) => HydratableInstance | null = shim;
export const getNextHydratableInstanceAfterSuspenseInstance: (suspenseInstance: SuspenseInstance) => HydratableInstance | null = shim;
export const finalizeHydratedChildren: (instance: Instance, type: Type, props: Props, hostContext: HostContext) => boolean = shim;
export const commitHydratedInstance: (instance: Instance, type: Type, props: Props, internalInstanceHandle: object) => void = shim;
export const commitHydratedContainer: (container: Container) => void = shim;
export const commitHydratedActivityInstance: (activityInstance: ActivityInstance) => void = shim;
export const commitHydratedSuspenseInstance: (suspenseInstance: SuspenseInstance) => void = shim;
export const flushHydrationEvents: () => void = shim;
export const clearActivityBoundary: (parentInstance: Instance, activityInstance: ActivityInstance) => void = shim;
export const clearSuspenseBoundary: (parentInstance: Instance, suspenseInstance: SuspenseInstance) => void = shim;
export const clearActivityBoundaryFromContainer: (container: Container, activityInstance: ActivityInstance) => void = shim;
export const clearSuspenseBoundaryFromContainer: (container: Container, suspenseInstance: SuspenseInstance) => void = shim;
export const hideDehydratedBoundary: (instance: SuspenseInstance | ActivityInstance) => void = shim;
export const unhideDehydratedBoundary: (instance: SuspenseInstance | ActivityInstance) => void = shim;
export const shouldDeleteUnhydratedTailInstances: (parentType: Type) => boolean = shim;
export const diffHydratedPropsForDevWarnings: (instance: Instance, type: Type, props: Props, hostContext: HostContext) => unknown = shim;
export const diffHydratedTextForDevWarnings: (textInstance: TextInstance, text: string, parentProps: Props | null) => unknown = shim;
export const describeHydratableInstanceForDevWarnings: (instance: HydratableInstance) => unknown = shim;
export const validateHydratableInstance: (type: Type, props: Props, hostContext: HostContext) => boolean = shim;
export const validateHydratableTextInstance: (text: string, hostContext: HostContext) => boolean = shim;
