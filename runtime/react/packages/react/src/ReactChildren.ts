// `React.Children`: walking `props.children` as React itself flattens it,
// with the keys React would give each child.

import { isDevelopment } from "shared/Build.ts";
import { checkKeyStringCoercion } from "shared/CheckStringCoercion.ts";
import { noop } from "shared/noop.ts";
import { getIteratorFn, REACT_ELEMENT_TYPE, REACT_LAZY_TYPE, REACT_PORTAL_TYPE } from "shared/ReactSymbols.ts";
import type { LazyComponent, ReactElement, Thenable } from "shared/ReactTypes.ts";
import { cloneAndReplaceKey, isValidElement } from "./jsx/ReactJSXElement.ts";

const SEPARATOR = ".";
const SUBSEPARATOR = ":";

// Escapes a key so that it cannot collide with the separators.
function escape(key: string): string {
  return "$" + key.replace(/[=:]/g, (match) => (match === "=" ? "=0" : "=2"));
}

let didWarnAboutMaps = false;

function escapeUserProvidedKey(text: string): string {
  return text.replace(/\/+/g, "$&/");
}

// A child's key within its set: its own key, or its index in base 36.
function getElementKey(element: unknown, index: number): string {
  if (typeof element === "object" && element !== null) {
    const key = (element as { key?: unknown }).key;
    if (key != null) {
      if (isDevelopment) {
        checkKeyStringCoercion(key);
      }
      return escape("" + (key as string));
    }
  }
  return index.toString(36);
}

// Reads a settled thenable, or throws it so that Suspense can wait for it.
function resolveThenable<T>(thenable: Thenable<T>): T {
  switch (thenable.status) {
    case "fulfilled":
      return thenable.value as T;
    case "rejected":
      throw thenable.reason;
    default: {
      if (typeof thenable.status === "string") {
        // Someone else is tracking it; make sure a rejection is handled.
        thenable.then(noop, noop);
      } else {
        thenable.status = "pending";
        thenable.then(
          (fulfilledValue) => {
            if (thenable.status === "pending") {
              thenable.status = "fulfilled";
              thenable.value = fulfilledValue;
            }
          },
          (error: unknown) => {
            if (thenable.status === "pending") {
              thenable.status = "rejected";
              thenable.reason = error;
            }
          },
        );
      }
      // A synchronous thenable may have settled already.
      const status = thenable.status as Thenable<T>["status"];
      if (status === "fulfilled") {
        return thenable.value as T;
      }
      if (status === "rejected") {
        throw thenable.reason;
      }
    }
  }
  throw thenable;
}

type MapCallback = (child: unknown) => unknown;

function mapIntoArray(
  input: unknown,
  array: unknown[],
  escapedPrefix: string,
  nameSoFar: string,
  callback: MapCallback,
): number {
  const type = typeof input;
  const children = type === "undefined" || type === "boolean" ? null : input;

  let invokeCallback = false;
  if (children === null) {
    invokeCallback = true;
  } else {
    switch (type) {
      case "bigint":
      case "string":
      case "number":
        invokeCallback = true;
        break;
      case "object":
        switch ((children as { $$typeof?: unknown }).$$typeof) {
          case REACT_ELEMENT_TYPE:
          case REACT_PORTAL_TYPE:
            invokeCallback = true;
            break;
          case REACT_LAZY_TYPE: {
            const lazy = children as LazyComponent<unknown, unknown>;
            return mapIntoArray(lazy._init(lazy._payload), array, escapedPrefix, nameSoFar, callback);
          }
        }
    }
  }

  if (invokeCallback) {
    const child = children;
    let mappedChild = callback(child);
    // A single child is named as if it were the only one in an array.
    const childKey = nameSoFar === "" ? SEPARATOR + getElementKey(child, 0) : nameSoFar;
    if (Array.isArray(mappedChild)) {
      const escapedChildKey = escapeUserProvidedKey(childKey) + "/";
      mapIntoArray(mappedChild, array, escapedChildKey, "", (c) => c);
    } else if (mappedChild != null) {
      if (isValidElement(mappedChild)) {
        const childElementKey = childKeyOf(child);
        if (isDevelopment && mappedChild.key != null && childElementKey !== mappedChild.key) {
          checkKeyStringCoercion(mappedChild.key);
        }
        // A key the callback gave the mapped element is kept, before the
        // position-derived part.
        const newChild = cloneAndReplaceKey(
          mappedChild,
          escapedPrefix +
            (mappedChild.key != null && childElementKey !== mappedChild.key
              ? escapeUserProvidedKey("" + mappedChild.key) + "/"
              : "") +
            childKey,
        );
        if (
          isDevelopment &&
          nameSoFar !== "" &&
          child != null &&
          isValidElement(child) &&
          child.key == null &&
          child._store !== undefined &&
          !child._store.validated &&
          newChild._store !== undefined
        ) {
          // The original child needed a key; make the clone fail validation
          // too so the reconciler still warns.
          newChild._store.validated = 2;
        }
        mappedChild = newChild;
      }
      array.push(mappedChild);
    }
    return 1;
  }

  let subtreeCount = 0;
  const nextNamePrefix = nameSoFar === "" ? SEPARATOR : nameSoFar + SUBSEPARATOR;

  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const child: unknown = children[i];
      subtreeCount += mapIntoArray(child, array, escapedPrefix, nextNamePrefix + getElementKey(child, i), callback);
    }
    return subtreeCount;
  }

  const iteratorFn = getIteratorFn(children);
  if (iteratorFn !== null) {
    if (isDevelopment && iteratorFn === (children as { entries?: unknown }).entries) {
      if (!didWarnAboutMaps) {
        console.warn("Using Maps as children is not supported. " + "Use an array of keyed ReactElements instead.");
      }
      didWarnAboutMaps = true;
    }
    const iterator = iteratorFn.call(children);
    let ii = 0;
    for (let step = iterator.next(); !step.done; step = iterator.next()) {
      const child = step.value;
      subtreeCount += mapIntoArray(child, array, escapedPrefix, nextNamePrefix + getElementKey(child, ii++), callback);
    }
    return subtreeCount;
  }

  if (type === "object") {
    const object = children as { then?: unknown };
    if (typeof object.then === "function") {
      return mapIntoArray(resolveThenable(children as Thenable<unknown>), array, escapedPrefix, nameSoFar, callback);
    }
    const childrenString = String(children);
    throw new Error(
      `Objects are not valid as a React child (found: ${
        childrenString === "[object Object]"
          ? "object with keys {" + Object.keys(children as object).join(", ") + "}"
          : childrenString
      }). ` + "If you meant to render a collection of children, use an array " + "instead.",
    );
  }
  return subtreeCount;
}

function childKeyOf(child: unknown): unknown {
  return child ? (child as { key?: unknown }).key : undefined;
}

type MapFunction = (this: unknown, child: unknown, index: number) => unknown;

function mapChildren(children: unknown, func: MapFunction, context?: unknown): unknown[] | null | undefined {
  if (children == null) {
    return children;
  }
  const result: unknown[] = [];
  let count = 0;
  mapIntoArray(children, result, "", "", (child) => func.call(context, child, count++));
  return result;
}

function countChildren(children: unknown): number {
  let n = 0;
  mapChildren(children, () => {
    n++;
  });
  return n;
}

function forEachChildren(
  children: unknown,
  forEachFunc: (this: unknown, child: unknown, index: number) => void,
  forEachContext?: unknown,
): void {
  mapChildren(
    children,
    function (this: unknown, child, index) {
      forEachFunc.call(this, child, index);
    },
    forEachContext,
  );
}

function toArray(children: unknown): unknown[] {
  return mapChildren(children, (child) => child) || [];
}

function onlyChild<T>(children: T): T & ReactElement {
  if (!isValidElement(children)) {
    throw new Error("React.Children.only expected to receive a single React element child.");
  }
  return children;
}

export { countChildren as count, forEachChildren as forEach, mapChildren as map, onlyChild as only, toArray };
