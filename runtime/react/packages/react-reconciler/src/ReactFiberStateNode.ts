// The typed views of `fiber.stateNode`.
//
// What a fiber's stateNode holds is fixed by its tag: the renderer's host
// instance for a host component, its text instance for host text, the
// container for a portal, the FiberRoot for the host root. These accessors
// are the only places the reconciler projects it, so the projection is
// written once per kind. A native build that checks downcasts checks here.

import type { Container, HydratableInstance, Instance, TextInstance } from "react-reconciler/ReactFiberConfig.ts";
import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import { HostRoot } from "./ReactWorkTags.ts";

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

// A HostRoot fiber's state: its FiberRoot.
export function fiberRootOf(fiber: Fiber): FiberRoot {
  return fiber.stateNode as FiberRoot;
}

// A HostRoot or HostPortal fiber: the container it renders into. Both keep
// a `containerInfo`, but in different objects (the FiberRoot, the portal's
// state), so the tag says which one is read rather than one view of both.
export function containerOf(fiber: Fiber): Container {
  return fiber.tag === HostRoot ? fiberRootOf(fiber).containerInfo : portalStateOf(fiber).containerInfo;
}

// Persistent mode: the child set a HostRoot or HostPortal fiber's container
// is given next.
export function setPendingChildren(fiber: Fiber, children: unknown): void {
  if (fiber.tag === HostRoot) {
    fiberRootOf(fiber).pendingChildren = children;
  } else {
    portalStateOf(fiber).pendingChildren = children;
  }
}

// DOM only (renderers with supportsResources): a hoistable host instance is
// an element, and its document is the root its hoistables mount into.
// JS object model: the reconciler reads the DOM's own property, as upstream's
// does; no other renderer reaches this.
export function ownerDocumentOf(instance: Instance): Container {
  return (instance as unknown as { readonly ownerDocument: Container }).ownerDocument;
}
