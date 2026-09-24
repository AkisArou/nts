// The test selector API (`findAllNodes`, `focusWithin`, ...): finding host
// instances by component, role, text or test name.

import { hostInstanceOf } from "./ReactFiberStateNode.ts";
import { getComponentNameFromType } from "shared/getComponentNameFromType.ts";
import type { Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import type { Instance } from "react-reconciler/ReactFiberConfig.ts";
import { HostComponent, HostHoistable, HostSingleton, HostText } from "./ReactWorkTags.ts";
import {
  findFiberRoot,
  getBoundingRect,
  getInstanceFromNode,
  getTextContent,
  isHiddenSubtree,
  matchAccessibilityRole,
  setFocusIfFocusable,
  setupIntersectionObserver,
  supportsTestSelectors,
} from "react-reconciler/ReactFiberConfig.ts";

const COMPONENT_TYPE: symbol = Symbol.for("selector.component");
const HAS_PSEUDO_CLASS_TYPE: symbol = Symbol.for("selector.has_pseudo_class");
const ROLE_TYPE: symbol = Symbol.for("selector.role");
const TEST_NAME_TYPE: symbol = Symbol.for("selector.test_id");
const TEXT_TYPE: symbol = Symbol.for("selector.text");

interface ComponentSelector {
  $$typeof: symbol;
  value: unknown;
}
interface HasPseudoClassSelector {
  $$typeof: symbol;
  value: Selector[];
}
interface StringSelector {
  $$typeof: symbol;
  value: string;
}

export type Selector = ComponentSelector | HasPseudoClassSelector | StringSelector;

export function createComponentSelector(component: unknown): ComponentSelector {
  return { $$typeof: COMPONENT_TYPE, value: component };
}

export function createHasPseudoClassSelector(selectors: Selector[]): HasPseudoClassSelector {
  return { $$typeof: HAS_PSEUDO_CLASS_TYPE, value: selectors };
}

export function createRoleSelector(role: string): StringSelector {
  return { $$typeof: ROLE_TYPE, value: role };
}

export function createTextSelector(text: string): StringSelector {
  return { $$typeof: TEXT_TYPE, value: text };
}

export function createTestNameSelector(id: string): StringSelector {
  return { $$typeof: TEST_NAME_TYPE, value: id };
}

function testNameOf(fiber: Fiber): unknown {
  return (fiber.memoizedProps as { [key: string]: unknown })["data-testname"];
}

function findFiberRootForHostRoot(hostRoot: Instance): Fiber {
  const maybeFiber = getInstanceFromNode(hostRoot) as Fiber | null | undefined;
  if (maybeFiber != null) {
    if (typeof testNameOf(maybeFiber) !== "string") {
      throw new Error(
        "Invalid host root specified. Should be either a React container or a node with a testname attribute.",
      );
    }
    return maybeFiber;
  }
  const fiberRoot = findFiberRoot(hostRoot) as { stateNode: FiberRoot } | null;
  if (fiberRoot === null) {
    throw new Error("Could not find React container within specified host subtree.");
  }
  // createFiberRoot() gives the host root fiber a `stateNode` pointing at
  // the FiberRoot.
  return fiberRoot.stateNode.current;
}

function isHostInstanceTag(tag: number): boolean {
  return tag === HostComponent || tag === HostHoistable || tag === HostSingleton;
}

function matchSelector(fiber: Fiber, selector: Selector): boolean {
  const tag = fiber.tag;
  switch (selector.$$typeof) {
    case COMPONENT_TYPE:
      if (fiber.type === selector.value) {
        return true;
      }
      break;
    case HAS_PSEUDO_CLASS_TYPE:
      return hasMatchingPaths(fiber, (selector as HasPseudoClassSelector).value);
    case ROLE_TYPE:
      if (isHostInstanceTag(tag)) {
        if (matchAccessibilityRole(hostInstanceOf(fiber), (selector as StringSelector).value)) {
          return true;
        }
      }
      break;
    case TEXT_TYPE:
      if (isHostInstanceTag(tag) || tag === HostText) {
        const textContent = getTextContent(fiber);
        if (textContent !== null && textContent.indexOf((selector as StringSelector).value) >= 0) {
          return true;
        }
      }
      break;
    case TEST_NAME_TYPE:
      if (isHostInstanceTag(tag)) {
        const dataTestID = testNameOf(fiber);
        if (
          typeof dataTestID === "string" &&
          dataTestID.toLowerCase() === (selector as StringSelector).value.toLowerCase()
        ) {
          return true;
        }
      }
      break;
    default:
      throw new Error("Invalid selector type specified.");
  }
  return false;
}

function selectorToString(selector: Selector): string | null {
  switch (selector.$$typeof) {
    case COMPONENT_TYPE: {
      const displayName = getComponentNameFromType(selector.value) || "Unknown";
      return `<${displayName}>`;
    }
    case HAS_PSEUDO_CLASS_TYPE:
      return `:has(${selectorToString(selector) || ""})`;
    case ROLE_TYPE:
      return `[role="${(selector as StringSelector).value}"]`;
    case TEXT_TYPE:
      return `"${(selector as StringSelector).value}"`;
    case TEST_NAME_TYPE:
      return `[data-testname="${(selector as StringSelector).value}"]`;
    default:
      throw new Error("Invalid selector type specified.");
  }
}

// A fiber to visit and how many selectors its ancestors matched. The search
// is breadth-first: a queue, as upstream's alternating array is.
interface PathStep {
  fiber: Fiber;
  selectorIndex: number;
}

function findPaths(root: Fiber, selectors: Selector[]): Fiber[] {
  const matchingFibers: Fiber[] = [];
  const queue: PathStep[] = [{ fiber: root, selectorIndex: 0 }];
  let index = 0;
  while (index < queue.length) {
    const { fiber } = queue[index]!;
    let { selectorIndex } = queue[index]!;
    index++;
    const tag = fiber.tag;
    let selector = selectors[selectorIndex];

    if (isHostInstanceTag(tag) && isHiddenSubtree(fiber)) {
      continue;
    }
    while (selector != null && matchSelector(fiber, selector)) {
      selectorIndex++;
      selector = selectors[selectorIndex];
    }

    if (selectorIndex === selectors.length) {
      matchingFibers.push(fiber);
    } else {
      let child = fiber.child;
      while (child !== null) {
        queue.push({ fiber: child, selectorIndex });
        child = child.sibling;
      }
    }
  }
  return matchingFibers;
}

// Same as findPaths but with eager bailout on first match
function hasMatchingPaths(root: Fiber, selectors: Selector[]): boolean {
  const queue: PathStep[] = [{ fiber: root, selectorIndex: 0 }];
  let index = 0;
  while (index < queue.length) {
    const { fiber } = queue[index]!;
    let { selectorIndex } = queue[index]!;
    index++;
    const tag = fiber.tag;
    let selector = selectors[selectorIndex];

    if (isHostInstanceTag(tag) && isHiddenSubtree(fiber)) {
      continue;
    }
    while (selector != null && matchSelector(fiber, selector)) {
      selectorIndex++;
      selector = selectors[selectorIndex];
    }

    if (selectorIndex === selectors.length) {
      return true;
    }
    let child = fiber.child;
    while (child !== null) {
      queue.push({ fiber: child, selectorIndex });
      child = child.sibling;
    }
  }
  return false;
}

function assertSupportsTestSelectors(): void {
  if (!supportsTestSelectors) {
    throw new Error("Test selector API is not supported by this renderer.");
  }
}

export function findAllNodes(hostRoot: Instance, selectors: Selector[]): Instance[] {
  assertSupportsTestSelectors();
  const root = findFiberRootForHostRoot(hostRoot);
  const matchingFibers = findPaths(root, selectors);

  const instanceRoots: Instance[] = [];
  const stack = Array.from(matchingFibers);
  let index = 0;
  while (index < stack.length) {
    const node = stack[index++]!;
    const tag = node.tag;
    if (isHostInstanceTag(tag)) {
      if (isHiddenSubtree(node)) {
        continue;
      }
      instanceRoots.push(hostInstanceOf(node));
    } else {
      let child = node.child;
      while (child !== null) {
        stack.push(child);
        child = child.sibling;
      }
    }
  }
  return instanceRoots;
}

export function getFindAllNodesFailureDescription(hostRoot: Instance, selectors: Selector[]): string | null {
  assertSupportsTestSelectors();
  const root = findFiberRootForHostRoot(hostRoot);

  let maxSelectorIndex = 0;
  const matchedNames: (string | null)[] = [];

  // The logic of this loop should be kept in sync with findPaths()
  const queue: PathStep[] = [{ fiber: root, selectorIndex: 0 }];
  let index = 0;
  while (index < queue.length) {
    const { fiber } = queue[index]!;
    let { selectorIndex } = queue[index]!;
    index++;
    const tag = fiber.tag;
    const selector = selectors[selectorIndex]!;

    if (isHostInstanceTag(tag) && isHiddenSubtree(fiber)) {
      continue;
    } else if (matchSelector(fiber, selector)) {
      matchedNames.push(selectorToString(selector));
      selectorIndex++;
      if (selectorIndex > maxSelectorIndex) {
        maxSelectorIndex = selectorIndex;
      }
    }

    if (selectorIndex < selectors.length) {
      let child = fiber.child;
      while (child !== null) {
        queue.push({ fiber: child, selectorIndex });
        child = child.sibling;
      }
    }
  }

  if (maxSelectorIndex < selectors.length) {
    const unmatchedNames: (string | null)[] = [];
    for (let i = maxSelectorIndex; i < selectors.length; i++) {
      unmatchedNames.push(selectorToString(selectors[i]!));
    }
    return (
      "findAllNodes was able to match part of the selector:\n" +
      `  ${matchedNames.join(" > ")}\n\n` +
      "No matching component was found for:\n" +
      `  ${unmatchedNames.join(" > ")}`
    );
  }
  return null;
}

export interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function findBoundingRects(hostRoot: Instance, selectors: Selector[]): BoundingRect[] {
  assertSupportsTestSelectors();
  const instanceRoots = findAllNodes(hostRoot, selectors);

  const boundingRects: BoundingRect[] = [];
  for (let i = 0; i < instanceRoots.length; i++) {
    boundingRects.push(getBoundingRect(instanceRoots[i]) as BoundingRect);
  }

  for (let i = boundingRects.length - 1; i > 0; i--) {
    const targetRect = boundingRects[i]!;
    const targetLeft = targetRect.x;
    const targetRight = targetLeft + targetRect.width;
    const targetTop = targetRect.y;
    const targetBottom = targetTop + targetRect.height;

    for (let j = i - 1; j >= 0; j--) {
      if (i !== j) {
        const otherRect = boundingRects[j]!;
        const otherLeft = otherRect.x;
        const otherRight = otherLeft + otherRect.width;
        const otherTop = otherRect.y;
        const otherBottom = otherTop + otherRect.height;

        // Merging all rects to the minimums set would be complicated,
        // but we can handle the most common cases:
        // 1. completely overlapping rects
        // 2. adjacent rects that are the same width or height (e.g. items in a list)
        //
        // Even given the above constraints,
        // we still won't end up with the fewest possible rects without doing multiple passes,
        // but it's good enough for this purpose.

        if (
          targetLeft >= otherLeft &&
          targetTop >= otherTop &&
          targetRight <= otherRight &&
          targetBottom <= otherBottom
        ) {
          // Complete overlapping rects; remove the inner one.
          boundingRects.splice(i, 1);
          break;
        } else if (
          targetLeft === otherLeft &&
          targetRect.width === otherRect.width &&
          !(otherBottom < targetTop) &&
          !(otherTop > targetBottom)
        ) {
          // Adjacent vertical rects; merge them.
          if (otherTop > targetTop) {
            otherRect.height += otherTop - targetTop;
            otherRect.y = targetTop;
          }
          if (otherBottom < targetBottom) {
            otherRect.height = targetBottom - otherTop;
          }
          boundingRects.splice(i, 1);
          break;
        } else if (
          targetTop === otherTop &&
          targetRect.height === otherRect.height &&
          !(otherRight < targetLeft) &&
          !(otherLeft > targetRight)
        ) {
          // Adjacent horizontal rects; merge them.
          if (otherLeft > targetLeft) {
            otherRect.width += otherLeft - targetLeft;
            otherRect.x = targetLeft;
          }
          if (otherRight < targetRight) {
            otherRect.width = targetRight - otherLeft;
          }
          boundingRects.splice(i, 1);
          break;
        }
      }
    }
  }
  return boundingRects;
}

export function focusWithin(hostRoot: Instance, selectors: Selector[]): boolean {
  assertSupportsTestSelectors();
  const root = findFiberRootForHostRoot(hostRoot);
  const matchingFibers = findPaths(root, selectors);

  const stack = Array.from(matchingFibers);
  let index = 0;
  while (index < stack.length) {
    const fiber = stack[index++]!;
    const tag = fiber.tag;
    if (isHiddenSubtree(fiber)) {
      continue;
    }
    if (isHostInstanceTag(tag)) {
      if (setFocusIfFocusable(hostInstanceOf(fiber))) {
        return true;
      }
    }
    let child = fiber.child;
    while (child !== null) {
      stack.push(child);
      child = child.sibling;
    }
  }
  return false;
}

const commitHooks: (() => void)[] = [];

export function onCommitRoot(): void {
  if (supportsTestSelectors) {
    commitHooks.forEach((commitHook) => commitHook());
  }
}

export type IntersectionObserverOptions = object;

export type ObserveVisibleRectsCallback = (intersections: { ratio: number; rect: BoundingRect }[]) => void;

export function observeVisibleRects(
  hostRoot: Instance,
  selectors: Selector[],
  callback: ObserveVisibleRectsCallback,
  options?: IntersectionObserverOptions,
): { disconnect: () => void } {
  assertSupportsTestSelectors();
  const instanceRoots = findAllNodes(hostRoot, selectors);
  const { disconnect, observe, unobserve } = setupIntersectionObserver(instanceRoots, callback, options);

  // When React mutates the host environment, we may need to change what we're listening to.
  const commitHook = (): void => {
    const nextInstanceRoots = findAllNodes(hostRoot, selectors);
    instanceRoots.forEach((target) => {
      if (nextInstanceRoots.indexOf(target) < 0) {
        unobserve(target);
      }
    });
    nextInstanceRoots.forEach((target) => {
      if (instanceRoots.indexOf(target) < 0) {
        observe(target);
      }
    });
  };

  commitHooks.push(commitHook);

  return {
    disconnect: () => {
      // Stop listening for React mutations:
      const index = commitHooks.indexOf(commitHook);
      if (index >= 0) {
        commitHooks.splice(index, 1);
      }
      // Disconnect the host observer:
      disconnect();
    },
  };
}
