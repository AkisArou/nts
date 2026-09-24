// Describes values as `[label, description]` rows for the performance
// timeline's property tooltips, and diffs two props objects so a render can
// say which props changed.

import { OMITTED_PROP_ERROR } from "./ReactFlightPropertyAccess.ts";
import { REACT_ELEMENT_TYPE } from "./ReactSymbols.ts";
import { getComponentNameFromType } from "./getComponentNameFromType.ts";

export type PropertyRow = [string, string];

// A value the diff reads keys from: any object, indexed by name.
type AnyObject = { [key: string]: unknown };

const hasOwnProperty = Object.prototype.hasOwnProperty;

const EMPTY_ARRAY = 0;
const COMPLEX_ARRAY = 1;
// Primitive values only that are accepted by JSON.stringify.
const PRIMITIVE_ARRAY = 2;
// Tuple arrays of string and value (like Headers, Map, etc).
const ENTRIES_ARRAY = 3;

// Showing wider objects in the devtools is not useful.
const OBJECT_WIDTH_LIMIT = 100;

function getArrayKind(array: readonly unknown[]): 0 | 1 | 2 | 3 {
  let kind: 0 | 1 | 2 | 3 = EMPTY_ARRAY;
  for (let i = 0; i < array.length && i < OBJECT_WIDTH_LIMIT; i++) {
    const value = array[i];
    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string") {
        // Key value tuple.
        if (kind !== EMPTY_ARRAY && kind !== ENTRIES_ARRAY) {
          return COMPLEX_ARRAY;
        }
        kind = ENTRIES_ARRAY;
      } else {
        return COMPLEX_ARRAY;
      }
    } else if (typeof value === "function") {
      return COMPLEX_ARRAY;
    } else if (typeof value === "string" && value.length > 50) {
      return COMPLEX_ARRAY;
    } else if (kind !== EMPTY_ARRAY && kind !== PRIMITIVE_ARRAY) {
      return COMPLEX_ARRAY;
    } else if (typeof value === "bigint") {
      return COMPLEX_ARRAY;
    } else {
      kind = PRIMITIVE_ARRAY;
    }
  }
  return kind;
}

export function addObjectToProperties(
  object: object,
  properties: PropertyRow[],
  indent: number,
  prefix: string,
): void {
  if (ArrayBuffer.isView(object)) {
    // Typed arrays can hold millions of elements; enumerating them with
    // for...in would materialize a key for every index. Their contents are
    // not useful here, and a DataView has no enumerable properties.
    return;
  }
  const record = object as AnyObject;
  let addedProperties = 0;
  for (const key in record) {
    if (hasOwnProperty.call(record, key) && key[0] !== "_") {
      addedProperties++;
      addValueToProperties(key, record[key], properties, indent, prefix);
      if (addedProperties >= OBJECT_WIDTH_LIMIT) {
        properties.push([
          prefix +
            "\xa0\xa0".repeat(indent) +
            "Only " +
            OBJECT_WIDTH_LIMIT +
            " properties are shown. React will not log more properties of this object.",
          "",
        ]);
        break;
      }
    }
  }
}

function readReactElementTypeof(value: object): unknown {
  // Prevents dotting into $$typeof in opaque origin windows.
  return "$$typeof" in value && hasOwnProperty.call(value, "$$typeof")
    ? (value as { $$typeof?: unknown }).$$typeof
    : undefined;
}

interface ElementLike {
  type: unknown;
  key: unknown;
  props: AnyObject;
}

interface PromiseLikeStatus {
  status?: unknown;
  value?: unknown;
  reason?: unknown;
}

export function addValueToProperties(
  propertyName: string,
  value: unknown,
  properties: PropertyRow[],
  indent: number,
  prefix: string,
): void {
  let desc: string;
  switch (typeof value) {
    case "object": {
      if (value === null) {
        desc = "null";
        break;
      }
      if (readReactElementTypeof(value) === REACT_ELEMENT_TYPE) {
        // JSX.
        const element = value as ElementLike;
        const typeName = getComponentNameFromType(element.type) || "…";
        const key = element.key;
        const props = element.props;
        const propsKeys = Object.keys(props);
        const propsLength = propsKeys.length;
        if (key == null && propsLength === 0) {
          desc = "<" + typeName + " />";
          break;
        }
        if (indent < 3 || (propsLength === 1 && propsKeys[0] === "children" && key == null)) {
          desc = "<" + typeName + " … />";
          break;
        }
        properties.push([prefix + "\xa0\xa0".repeat(indent) + propertyName, "<" + typeName]);
        if (key !== null) {
          addValueToProperties("key", key, properties, indent + 1, prefix);
        }
        let hasChildren = false;
        let addedProperties = 0;
        for (const propKey in props) {
          addedProperties++;
          if (propKey === "children") {
            const children = props["children"];
            if (children != null && (!Array.isArray(children) || children.length > 0)) {
              hasChildren = true;
            }
          } else if (hasOwnProperty.call(props, propKey) && propKey[0] !== "_") {
            addValueToProperties(propKey, props[propKey], properties, indent + 1, prefix);
          }
          if (addedProperties >= OBJECT_WIDTH_LIMIT) {
            break;
          }
        }
        properties.push(["", hasChildren ? ">…</" + typeName + ">" : "/>"]);
        return;
      }
      const objectToString = Object.prototype.toString.call(value);
      let objectName = objectToString.slice(8, objectToString.length - 1);
      if (ArrayBuffer.isView(value)) {
        // Typed arrays: their type and length are more useful than every
        // index. DataView is the only view without a length.
        const length = (value as { length?: unknown }).length;
        desc = typeof length === "number" ? objectName + "(" + length + ")" : objectName;
        break;
      }
      if (objectName === "Array") {
        const array = value as unknown[];
        const didTruncate = array.length > OBJECT_WIDTH_LIMIT;
        const kind = getArrayKind(array);
        if (kind === PRIMITIVE_ARRAY || kind === EMPTY_ARRAY) {
          desc = JSON.stringify(didTruncate ? array.slice(0, OBJECT_WIDTH_LIMIT).concat("…") : array);
          break;
        } else if (kind === ENTRIES_ARRAY) {
          properties.push([prefix + "\xa0\xa0".repeat(indent) + propertyName, ""]);
          for (let i = 0; i < array.length && i < OBJECT_WIDTH_LIMIT; i++) {
            const entry = array[i] as [string, unknown];
            addValueToProperties(entry[0], entry[1], properties, indent + 1, prefix);
          }
          if (didTruncate) {
            addValueToProperties(OBJECT_WIDTH_LIMIT.toString(), "…", properties, indent + 1, prefix);
          }
          return;
        }
      }
      if (objectName === "Promise") {
        const promise = value as PromiseLikeStatus;
        if (promise.status === "fulfilled") {
          // Print the inner value.
          const idx = properties.length;
          addValueToProperties(propertyName, promise.value, properties, indent, prefix);
          if (properties.length > idx) {
            // Wrap the value or type in a Promise descriptor.
            const insertedEntry = properties[idx]!;
            insertedEntry[1] = "Promise<" + (insertedEntry[1] || "Object") + ">";
            return;
          }
        } else if (promise.status === "rejected") {
          // Print the inner error.
          const idx = properties.length;
          addValueToProperties(propertyName, promise.reason, properties, indent, prefix);
          if (properties.length > idx) {
            const insertedEntry = properties[idx]!;
            insertedEntry[1] = "Rejected Promise<" + insertedEntry[1] + ">";
            return;
          }
        }
        properties.push(["\xa0\xa0".repeat(indent) + propertyName, "Promise"]);
        return;
      }
      if (objectName === "Object") {
        const proto: unknown = Object.getPrototypeOf(value);
        if (proto) {
          const constructor = (proto as { constructor?: unknown }).constructor;
          if (typeof constructor === "function") {
            objectName = constructor.name;
          }
        }
      }
      properties.push([
        prefix + "\xa0\xa0".repeat(indent) + propertyName,
        objectName === "Object" ? (indent < 3 ? "" : "…") : objectName,
      ]);
      if (indent < 3) {
        addObjectToProperties(value, properties, indent + 1, prefix);
      }
      return;
    }
    case "function": {
      const functionName: unknown = (value as { name?: unknown }).name;
      // e.g. proxied functions or classes with a static property "name" that's not a string.
      desc = functionName === "" || typeof functionName !== "string" ? "() => {}" : functionName + "() {}";
      break;
    }
    case "string":
      if (value === OMITTED_PROP_ERROR) {
        desc = "…";
      } else {
        const text = value as string;
        desc = JSON.stringify(text.length >= 1024 ? text.slice(0, 1023) + "…" : text);
      }
      break;
    case "undefined":
      desc = "undefined";
      break;
    case "boolean":
      desc = value ? "true" : "false";
      break;
    default:
      desc = String(value);
  }
  properties.push([prefix + "\xa0\xa0".repeat(indent) + propertyName, desc]);
}

const REMOVED = "-\xa0";
const ADDED = "+\xa0";
const UNCHANGED = " \xa0";

// Adds the differences between two objects; returns whether they are deeply
// equal.
export function addObjectDiffToProperties(
  prev: object,
  next: object,
  properties: PropertyRow[],
  indent: number,
): boolean {
  // Note: We diff even non-owned properties here but things that are shared
  // end up just the same. If a property is added or removed, we just emit the
  // property name and omit the value it had. Mainly for performance.
  const prevRecord = prev as AnyObject;
  const nextRecord = next as AnyObject;
  let isDeeplyEqual = true;
  let prevPropertiesChecked = 0;
  for (const key in prevRecord) {
    if (prevPropertiesChecked > OBJECT_WIDTH_LIMIT) {
      properties.push([
        "Previous object has more than " +
          OBJECT_WIDTH_LIMIT +
          " properties. React will not attempt to diff objects with too many properties.",
        "",
      ]);
      isDeeplyEqual = false;
      break;
    }
    if (!(key in nextRecord)) {
      properties.push([REMOVED + "\xa0\xa0".repeat(indent) + key, "…"]);
      isDeeplyEqual = false;
    }
    prevPropertiesChecked++;
  }

  let nextPropertiesChecked = 0;
  for (const key in nextRecord) {
    if (nextPropertiesChecked > OBJECT_WIDTH_LIMIT) {
      properties.push([
        "Next object has more than " +
          OBJECT_WIDTH_LIMIT +
          " properties. React will not attempt to diff objects with too many properties.",
        "",
      ]);
      isDeeplyEqual = false;
      break;
    }
    if (key in prevRecord) {
      const prevValue = prevRecord[key];
      const nextValue = nextRecord[key];
      if (prevValue !== nextValue) {
        if (indent === 0 && key === "children") {
          // Omit any change inside the top level children prop since it's
          // expected to change with any change to children, but still mark it
          // as a cause of render.
          const line = "\xa0\xa0".repeat(indent) + key;
          properties.push([REMOVED + line, "…"], [ADDED + line, "…"]);
          isDeeplyEqual = false;
          continue;
        }
        if (indent >= 3) {
          // Just fall through to print the two values if we're deep.
        } else if (
          typeof prevValue === "object" &&
          typeof nextValue === "object" &&
          prevValue !== null &&
          nextValue !== null &&
          readReactElementTypeof(prevValue) === readReactElementTypeof(nextValue)
        ) {
          if (readReactElementTypeof(nextValue) === REACT_ELEMENT_TYPE) {
            const prevElement = prevValue as ElementLike;
            const nextElement = nextValue as ElementLike;
            if (prevElement.type === nextElement.type && prevElement.key === nextElement.key) {
              // If only the props of a nested element changed, omit them:
              // they are likely represented as a diff elsewhere.
              const typeName = getComponentNameFromType(nextElement.type) || "…";
              const line = "\xa0\xa0".repeat(indent) + key;
              const desc = "<" + typeName + " … />";
              properties.push([REMOVED + line, desc], [ADDED + line, desc]);
              isDeeplyEqual = false;
              continue;
            }
          } else {
            const prevKind = Object.prototype.toString.call(prevValue);
            const nextKind = Object.prototype.toString.call(nextValue);
            if (prevKind === nextKind && (nextKind === "[object Object]" || nextKind === "[object Array]")) {
              // Diff the nested object.
              const entry: PropertyRow = [
                UNCHANGED + "\xa0\xa0".repeat(indent) + key,
                nextKind === "[object Array]" ? "Array" : "",
              ];
              properties.push(entry);
              const prevLength = properties.length;
              const nestedEqual = addObjectDiffToProperties(prevValue, nextValue, properties, indent + 1);
              if (!nestedEqual) {
                isDeeplyEqual = false;
              } else if (prevLength === properties.length) {
                // Nothing notably changed inside: only reference equality.
                entry[1] = "Referentially unequal but deeply equal objects. Consider memoization.";
              }
              continue;
            }
          }
        } else if (typeof prevValue === "function" && typeof nextValue === "function") {
          const prevFunction = prevValue as { name: string; length: number };
          const nextFunction = nextValue as { name: string; length: number };
          if (prevFunction.name === nextFunction.name && prevFunction.length === nextFunction.length) {
            const prevSrc = Function.prototype.toString.call(prevValue);
            const nextSrc = Function.prototype.toString.call(nextValue);
            if (prevSrc === nextSrc) {
              // Looks like the same function but a different closure.
              const desc = nextFunction.name === "" ? "() => {}" : nextFunction.name + "() {}";
              properties.push([
                UNCHANGED + "\xa0\xa0".repeat(indent) + key,
                desc + " Referentially unequal function closure. Consider memoization.",
              ]);
              continue;
            }
          }
        }
        // Otherwise, emit the change in property and the values.
        addValueToProperties(key, prevValue, properties, indent, REMOVED);
        addValueToProperties(key, nextValue, properties, indent, ADDED);
        isDeeplyEqual = false;
      }
    } else {
      properties.push([ADDED + "\xa0\xa0".repeat(indent) + key, "…"]);
      isDeeplyEqual = false;
    }
    nextPropertiesChecked++;
  }
  return isDeeplyEqual;
}
