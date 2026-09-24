// Development only: warns when two mounted <ViewTransition> components share
// a name. This should technically be tracked per document, because two
// documents have separate namespaces, but to keep things simple it is one
// global map. Technically it should also include any manually assigned
// view-transition-name outside React too.
//
// Port of upstream's ReactFiberDuplicateViewTransitions.js.

import type { Fiber } from "./ReactInternalTypes.ts";
import type { ViewTransitionProps } from "./ReactFiberViewTransitionComponent.ts";
import { isDevelopment } from "shared/Build.ts";
import { runWithFiberInDEV } from "./ReactCurrentFiber.ts";

const mountedNamedViewTransitions: Map<string, Fiber> = new Map<string, Fiber>();
const didWarnAboutName: { [name: string]: boolean } = {};

export function trackNamedViewTransition(fiber: Fiber): void {
  if (isDevelopment) {
    const name = (fiber.memoizedProps as ViewTransitionProps).name;
    if (name != null && name !== "auto") {
      const existing = mountedNamedViewTransitions.get(name);
      if (existing !== undefined) {
        if (existing !== fiber && existing !== fiber.alternate) {
          if (!didWarnAboutName[name]) {
            didWarnAboutName[name] = true;
            const stringifiedName = JSON.stringify(name);
            runWithFiberInDEV(fiber, () => {
              console.error(
                "There are two <ViewTransition name=%s> components with the same name mounted " +
                  "at the same time. This is not supported and will cause View Transitions " +
                  "to error. Try to use a more unique name e.g. by using a namespace prefix " +
                  "and adding the id of an item to the name.",
                stringifiedName,
              );
            });
            runWithFiberInDEV(existing, () => {
              console.error("The existing <ViewTransition name=%s> duplicate has this stack trace.", stringifiedName);
            });
          }
        }
      } else {
        mountedNamedViewTransitions.set(name, fiber);
      }
    }
  }
}

export function untrackNamedViewTransition(fiber: Fiber): void {
  if (isDevelopment) {
    const name = (fiber.memoizedProps as ViewTransitionProps).name;
    if (name != null && name !== "auto") {
      const existing = mountedNamedViewTransitions.get(name);
      if (existing !== undefined && (existing === fiber || existing === fiber.alternate)) {
        mountedNamedViewTransitions.delete(name);
      }
    }
  }
}
