// Legacy context (`contextTypes`, `childContextTypes`, `getChildContext`).
//
// disableLegacyContext is on in the stable channel, so every function here
// is its disabled branch: there is no legacy context stack, contexts are
// empty and never change. The API stays so that callers keep upstream's
// shape.

import { isDevelopment } from "shared/Build.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

type ContextObject = { [key: string]: unknown };

export const emptyContextObject: ContextObject = {};
if (isDevelopment) {
  Object.freeze(emptyContextObject);
}

function getUnmaskedContext(
  _workInProgress: Fiber,
  _Component: unknown,
  _didPushOwnContextIfProvider: boolean,
): ContextObject {
  return emptyContextObject;
}

function cacheContext(_workInProgress: Fiber, _unmaskedContext: ContextObject, _maskedContext: ContextObject): void {}

function getMaskedContext(_workInProgress: Fiber, _unmaskedContext: ContextObject): ContextObject {
  return emptyContextObject;
}

function hasContextChanged(): boolean {
  return false;
}

function isContextProvider(_type: unknown): boolean {
  return false;
}

function popContext(_fiber: Fiber): void {}

function popTopLevelContextObject(_fiber: Fiber): void {}

function pushTopLevelContextObject(_fiber: Fiber, _context: ContextObject, _didChange: boolean): void {}

function processChildContext(_fiber: Fiber, _type: unknown, parentContext: ContextObject): ContextObject {
  return parentContext;
}

function pushContextProvider(_workInProgress: Fiber): boolean {
  return false;
}

function invalidateContextProvider(_workInProgress: Fiber, _type: unknown, _didChange: boolean): void {}

function findCurrentUnmaskedContext(_fiber: Fiber): ContextObject {
  return emptyContextObject;
}

export {
  getUnmaskedContext,
  cacheContext,
  getMaskedContext,
  hasContextChanged,
  popContext,
  popTopLevelContextObject,
  pushTopLevelContextObject,
  processChildContext,
  isContextProvider,
  pushContextProvider,
  invalidateContextProvider,
  findCurrentUnmaskedContext,
};
