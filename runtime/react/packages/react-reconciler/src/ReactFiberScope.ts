// `<unstable_Scope>`: a component whose instance can query the host nodes
// below it. enableScopeAPI is off in the stable channel; the module is kept
// with upstream's behaviour for when it is on.

import type { ReactContext } from "shared/ReactTypes.ts";
import { enableScopeAPI } from "shared/ReactFeatureFlags.ts";
import { getInstanceFromNode, getInstanceFromScope, getPublicInstance } from "./ReactFiberConfig.ts";
import { isFiberSuspenseAndTimedOut } from "./ReactFiberTreeReflection.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import { ContextProvider, HostComponent, ScopeComponent } from "./ReactWorkTags.ts";

export type ReactScopeQuery = (type: string, props: { [name: string]: unknown }, instance: unknown) => boolean;

export interface ReactScopeInstance {
  DO_NOT_USE_queryAllNodes(fn: ReactScopeQuery): unknown[] | null;
  DO_NOT_USE_queryFirstNode(fn: ReactScopeQuery): unknown;
  containsNode(node: object): boolean;
  getChildContextValues<T>(context: ReactContext<T>): T[];
}

function getSuspenseFallbackChild(fiber: Fiber): Fiber | null {
  return fiber.child!.sibling!.child;
}

const emptyObject: { [name: string]: unknown } = {};

function collectScopedNodes(node: Fiber, fn: ReactScopeQuery, scopedNodes: unknown[]): void {
  if (enableScopeAPI) {
    if (node.tag === HostComponent) {
      const instance = getPublicInstance(node.stateNode);
      const props = (node.memoizedProps as { [name: string]: unknown } | null) || emptyObject;
      if (instance !== null && fn(node.type as string, props, instance) === true) {
        scopedNodes.push(instance);
      }
    }
    let child = node.child;
    if (isFiberSuspenseAndTimedOut(node)) {
      child = getSuspenseFallbackChild(node);
    }
    if (child !== null) {
      collectScopedNodesFromChildren(child, fn, scopedNodes);
    }
  }
}

function collectFirstScopedNode(node: Fiber, fn: ReactScopeQuery): unknown {
  if (enableScopeAPI) {
    if (node.tag === HostComponent) {
      const instance = getPublicInstance(node.stateNode);
      if (instance !== null && fn(node.type as string, node.memoizedProps as { [name: string]: unknown }, instance) === true) {
        return instance;
      }
    }
    let child = node.child;
    if (isFiberSuspenseAndTimedOut(node)) {
      child = getSuspenseFallbackChild(node);
    }
    if (child !== null) {
      return collectFirstScopedNodeFromChildren(child, fn);
    }
  }
  return null;
}

function collectScopedNodesFromChildren(startingChild: Fiber, fn: ReactScopeQuery, scopedNodes: unknown[]): void {
  let child: Fiber | null = startingChild;
  while (child !== null) {
    collectScopedNodes(child, fn, scopedNodes);
    child = child.sibling;
  }
}

function collectFirstScopedNodeFromChildren(startingChild: Fiber, fn: ReactScopeQuery): unknown {
  let child: Fiber | null = startingChild;
  while (child !== null) {
    const scopedNode = collectFirstScopedNode(child, fn);
    if (scopedNode !== null) {
      return scopedNode;
    }
    child = child.sibling;
  }
  return null;
}

function collectNearestContextValues<T>(node: Fiber, context: ReactContext<T>, childContextValues: T[]): void {
  if (node.tag === ContextProvider && node.type === context) {
    childContextValues.push((node.memoizedProps as { value: T }).value);
  } else {
    let child = node.child;
    if (isFiberSuspenseAndTimedOut(node)) {
      child = getSuspenseFallbackChild(node);
    }
    if (child !== null) {
      collectNearestChildContextValues(child, context, childContextValues);
    }
  }
}

function collectNearestChildContextValues<T>(startingChild: Fiber | null, context: ReactContext<T>, childContextValues: T[]): void {
  let child = startingChild;
  while (child !== null) {
    collectNearestContextValues(child, context, childContextValues);
    child = child.sibling;
  }
}

function scopeFiber(scopeInstance: ReactScopeInstance): Fiber | null {
  return getInstanceFromScope(scopeInstance) as Fiber | null;
}

export function createScopeInstance(): ReactScopeInstance {
  const scope: ReactScopeInstance = {
    DO_NOT_USE_queryAllNodes(fn) {
      const currentFiber = scopeFiber(scope);
      if (currentFiber === null) {
        return null;
      }
      const child = currentFiber.child;
      const scopedNodes: unknown[] = [];
      if (child !== null) {
        collectScopedNodesFromChildren(child, fn, scopedNodes);
      }
      return scopedNodes.length === 0 ? null : scopedNodes;
    },
    DO_NOT_USE_queryFirstNode(fn) {
      const currentFiber = scopeFiber(scope);
      if (currentFiber === null) {
        return null;
      }
      const child = currentFiber.child;
      if (child !== null) {
        return collectFirstScopedNodeFromChildren(child, fn);
      }
      return null;
    },
    containsNode(node) {
      let fiber = getInstanceFromNode(node) as Fiber | null;
      while (fiber !== null) {
        if (fiber.tag === ScopeComponent && fiber.stateNode === scope) {
          return true;
        }
        fiber = fiber.return;
      }
      return false;
    },
    getChildContextValues<T>(context: ReactContext<T>): T[] {
      const currentFiber = scopeFiber(scope);
      if (currentFiber === null) {
        return [];
      }
      const child = currentFiber.child;
      const childContextValues: T[] = [];
      if (child !== null) {
        collectNearestChildContextValues(child, context, childContextValues);
      }
      return childContextValues;
    },
  };
  return scope;
}
