// The typed views of `fiber.stateNode`.
//
// What a fiber's stateNode holds is fixed by its tag: the renderer's host
// instance for a host component, its text instance for host text, the
// container for a portal, the FiberRoot for the host root. These accessors
// are the only places the reconciler projects it, so the projection is
// written once per kind. A native build that checks downcasts checks here.

import type { Container, HydratableInstance, Instance, TextInstance } from "react-reconciler/ReactFiberConfig.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

// A HostComponent, HostHoistable or HostSingleton fiber.
export function hostInstanceOf(fiber: Fiber): Instance {
  return fiber.stateNode as Instance;
}

// A HostText fiber.
export function textInstanceOf(fiber: Fiber): TextInstance {
  return fiber.stateNode as TextInstance;
}

// A host component or host text fiber: whichever it is.
export function hostNodeOf(fiber: Fiber): Instance | TextInstance {
  return fiber.stateNode as Instance | TextInstance;
}

// A host fiber during hydration: the host node it is hydrating.
export function hydratableInstanceOf(fiber: Fiber): HydratableInstance {
  return fiber.stateNode as HydratableInstance;
}

// A HostPortal fiber's state: the container it renders into.
export interface PortalStateNode {
  containerInfo: Container;
  pendingChildren: unknown;
  implementation: unknown;
}

export function portalStateOf(fiber: Fiber): PortalStateNode {
  return fiber.stateNode as PortalStateNode;
}

// DOM only (renderers with supportsResources): a hoistable host instance is
// an element, and its document is the root its hoistables mount into.
// JS object model: the reconciler reads the DOM's own property, as upstream's
// does; no other renderer reaches this.
export function ownerDocumentOf(instance: Instance): Container {
  return (instance as unknown as { readonly ownerDocument: Container }).ownerDocument;
}
