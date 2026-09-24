// Renderers that don't support hydration
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { Container, HostContext, HydratableInstance, Instance, Props, TextInstance, Type } from "react-reconciler/ReactFiberConfig.ts";

function notSupported(): Error {
  return new Error(
    "The current renderer does not support hydration. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export type ActivityInstance = unknown;
export type SuspenseInstance = unknown;
export const supportsHydration: boolean = false;
export function isSuspenseInstancePending(_instance: SuspenseInstance): boolean {
  throw notSupported();
}
export function isSuspenseInstanceFallback(_instance: SuspenseInstance): boolean {
  throw notSupported();
}
export function getSuspenseInstanceFallbackErrorDetails(_instance: SuspenseInstance): { digest?: string; message?: string; stack?: string; componentStack?: string; } {
  throw notSupported();
}
export function registerSuspenseInstanceRetry(_instance: SuspenseInstance, _callback: () => void): void {
  throw notSupported();
}
export function canHydrateFormStateMarker(_instance: HydratableInstance, _inRootOrSingleton: boolean): unknown {
  throw notSupported();
}
export function isFormStateMarkerMatching(_markerInstance: unknown): boolean {
  throw notSupported();
}
export function getNextHydratableSibling(_instance: HydratableInstance): HydratableInstance | null {
  throw notSupported();
}
export function getNextHydratableSiblingAfterSingleton(_type: Type, _fallbackInstance: HydratableInstance): HydratableInstance | null {
  throw notSupported();
}
export function getFirstHydratableChild(_parentInstance: Instance): HydratableInstance | null {
  throw notSupported();
}
export function getFirstHydratableChildWithinContainer(_parentContainer: Container): HydratableInstance | null {
  throw notSupported();
}
export function getFirstHydratableChildWithinActivityInstance(_parentInstance: ActivityInstance): HydratableInstance | null {
  throw notSupported();
}
export function getFirstHydratableChildWithinSuspenseInstance(_parentInstance: SuspenseInstance): HydratableInstance | null {
  throw notSupported();
}
export function getFirstHydratableChildWithinSingleton(_type: Type, _singletonInstance: Instance, _currentHydratableInstance: HydratableInstance | null): HydratableInstance | null {
  throw notSupported();
}
export function canHydrateInstance(_instance: HydratableInstance, _type: Type, _props: Props, _inRootOrSingleton: boolean): Instance | null {
  throw notSupported();
}
export function canHydrateTextInstance(_instance: HydratableInstance, _text: string, _inRootOrSingleton: boolean): TextInstance | null {
  throw notSupported();
}
export function canHydrateActivityInstance(_instance: HydratableInstance, _inRootOrSingleton: boolean): ActivityInstance | null {
  throw notSupported();
}
export function canHydrateSuspenseInstance(_instance: HydratableInstance, _inRootOrSingleton: boolean): SuspenseInstance | null {
  throw notSupported();
}
export function hydrateInstance(_instance: Instance, _type: Type, _props: Props, _hostContext: HostContext, _internalInstanceHandle: object): boolean {
  throw notSupported();
}
export function hydrateTextInstance(_textInstance: TextInstance, _text: string, _internalInstanceHandle: object, _parentInstanceProps: Props | null): boolean {
  throw notSupported();
}
export function hydrateActivityInstance(_activityInstance: ActivityInstance, _internalInstanceHandle: object): void {
  throw notSupported();
}
export function hydrateSuspenseInstance(_suspenseInstance: SuspenseInstance, _internalInstanceHandle: object): void {
  throw notSupported();
}
export function getNextHydratableInstanceAfterActivityInstance(_activityInstance: ActivityInstance): HydratableInstance | null {
  throw notSupported();
}
export function getNextHydratableInstanceAfterSuspenseInstance(_suspenseInstance: SuspenseInstance): HydratableInstance | null {
  throw notSupported();
}
export function finalizeHydratedChildren(_instance: Instance, _type: Type, _props: Props, _hostContext: HostContext): boolean {
  throw notSupported();
}
export function commitHydratedInstance(_instance: Instance, _type: Type, _props: Props, _internalInstanceHandle: object): void {
  throw notSupported();
}
export function commitHydratedContainer(_container: Container): void {
  throw notSupported();
}
export function commitHydratedActivityInstance(_activityInstance: ActivityInstance): void {
  throw notSupported();
}
export function commitHydratedSuspenseInstance(_suspenseInstance: SuspenseInstance): void {
  throw notSupported();
}
export function flushHydrationEvents(): void {
  throw notSupported();
}
export function clearActivityBoundary(_parentInstance: Instance, _activityInstance: ActivityInstance): void {
  throw notSupported();
}
export function clearSuspenseBoundary(_parentInstance: Instance, _suspenseInstance: SuspenseInstance): void {
  throw notSupported();
}
export function clearActivityBoundaryFromContainer(_container: Container, _activityInstance: ActivityInstance): void {
  throw notSupported();
}
export function clearSuspenseBoundaryFromContainer(_container: Container, _suspenseInstance: SuspenseInstance): void {
  throw notSupported();
}
export function hideDehydratedBoundary(_instance: SuspenseInstance | ActivityInstance): void {
  throw notSupported();
}
export function unhideDehydratedBoundary(_instance: SuspenseInstance | ActivityInstance): void {
  throw notSupported();
}
export function shouldDeleteUnhydratedTailInstances(_parentType: Type): boolean {
  throw notSupported();
}
export function diffHydratedPropsForDevWarnings(_instance: Instance, _type: Type, _props: Props, _hostContext: HostContext): unknown {
  throw notSupported();
}
export function diffHydratedTextForDevWarnings(_textInstance: TextInstance, _text: string, _parentProps: Props | null): unknown {
  throw notSupported();
}
export function describeHydratableInstanceForDevWarnings(_instance: HydratableInstance): unknown {
  throw notSupported();
}
export function validateHydratableInstance(_type: Type, _props: Props, _hostContext: HostContext): boolean {
  throw notSupported();
}
export function validateHydratableTextInstance(_text: string, _hostContext: HostContext): boolean {
  throw notSupported();
}
