// Development-only formatting of a hydration mismatch as a diff between the
// client's tree and the server's, for the error message.

import { getComponentNameFromType } from "shared/getComponentNameFromType.ts";
import { enableSrcObject } from "shared/ReactFeatureFlags.ts";
import { REACT_ELEMENT_TYPE } from "shared/ReactSymbols.ts";
import { isDevelopment } from "shared/Build.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import {
  ActivityComponent,
  ClassComponent,
  ForwardRef,
  FunctionComponent,
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
  LazyComponent,
  SimpleMemoComponent,
  SuspenseComponent,
  SuspenseListComponent,
} from "./ReactWorkTags.ts";

type PropsObject = { readonly [propName: string]: unknown };

export interface HydrationDiffNode {
  fiber: Fiber;
  children: HydrationDiffNode[];
  // null means no matching server node.
  serverProps: undefined | null | PropsObject | string;
  serverTail: ({ type: string; props: PropsObject } | string)[];
  distanceFromLeaf: number;
}

const maxRowLength = 120;
const idealDepth = 15;

function hasOwn(object: object, propName: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, propName);
}

function findNotableNode(node: HydrationDiffNode, indent: number): HydrationDiffNode {
  if (
    node.serverProps === undefined &&
    node.serverTail.length === 0 &&
    node.children.length === 1 &&
    node.distanceFromLeaf > 3 &&
    node.distanceFromLeaf > idealDepth - indent
  ) {
    // This is not an interesting node for contextual purposes so we can skip it.
    return findNotableNode(node.children[0]!, indent);
  }
  return node;
}

function indentation(indent: number): string {
  return "  " + "  ".repeat(indent);
}

function added(indent: number): string {
  return "+ " + "  ".repeat(indent);
}

function removed(indent: number): string {
  return "- " + "  ".repeat(indent);
}

function nameOfFunction(fn: unknown): string | null {
  const named = fn as { displayName?: string; name?: string };
  return named.displayName || named.name || null;
}

function describeFiberType(fiber: Fiber): string | null {
  switch (fiber.tag) {
    case HostHoistable:
    case HostSingleton:
    case HostComponent:
      return fiber.type as string;
    case LazyComponent:
      return "Lazy";
    case ActivityComponent:
      return "Activity";
    case SuspenseComponent:
      return "Suspense";
    case SuspenseListComponent:
      return "SuspenseList";
    case FunctionComponent:
    case SimpleMemoComponent:
      return nameOfFunction(fiber.type);
    case ForwardRef:
      return nameOfFunction((fiber.type as { render: unknown }).render);
    case ClassComponent:
      return nameOfFunction(fiber.type);
    default:
      // Skip
      return null;
  }
}

const needsEscaping = /["'&<>\n\t]|^\s|\s$/;

function describeTextNode(content: string, maxLength: number): string {
  if (needsEscaping.test(content)) {
    const encoded = JSON.stringify(content);
    if (encoded.length > maxLength - 2) {
      if (maxLength < 8) {
        return '{"..."}';
      }
      return "{" + encoded.slice(0, maxLength - 7) + '..."}';
    }
    return "{" + encoded + "}";
  }
  if (content.length > maxLength) {
    if (maxLength < 5) {
      return '{"..."}';
    }
    return content.slice(0, maxLength - 3) + "...";
  }
  return content;
}

function describeTextDiff(clientText: string, serverProps: unknown, indent: number): string {
  const maxLength = maxRowLength - indent * 2;
  if (serverProps === null) {
    return added(indent) + describeTextNode(clientText, maxLength) + "\n";
  } else if (typeof serverProps === "string") {
    let serverText: string = serverProps;
    let firstDiff = 0;
    for (; firstDiff < serverText.length && firstDiff < clientText.length; firstDiff++) {
      if (serverText.charCodeAt(firstDiff) !== clientText.charCodeAt(firstDiff)) {
        break;
      }
    }
    if (firstDiff > maxLength - 8 && firstDiff > 10) {
      // The first difference between the two strings would be cut off, so cut off in
      // the beginning instead.
      clientText = "..." + clientText.slice(firstDiff - 8);
      serverText = "..." + serverText.slice(firstDiff - 8);
    }
    return (
      added(indent) +
      describeTextNode(clientText, maxLength) +
      "\n" +
      removed(indent) +
      describeTextNode(serverText, maxLength) +
      "\n"
    );
  }
  return indentation(indent) + describeTextNode(clientText, maxLength) + "\n";
}

function objectName(object: unknown): string {
  const name: string = Object.prototype.toString.call(object);
  return name.replace(/^\[object (.*)\]$/, (_m: string, p0: string) => p0);
}

function describeValue(value: unknown, maxLengthIn: number): string {
  let maxLength = maxLengthIn;
  switch (typeof value) {
    case "string": {
      const encoded = JSON.stringify(value);
      if (encoded.length > maxLength) {
        if (maxLength < 5) {
          return '"..."';
        }
        return encoded.slice(0, maxLength - 4) + '..."';
      }
      return encoded;
    }
    case "object": {
      if (value === null) {
        return "null";
      }
      if (Array.isArray(value)) {
        return "[...]";
      }
      const element = value as { $$typeof?: unknown; type?: unknown };
      if (element.$$typeof === REACT_ELEMENT_TYPE) {
        const type = getComponentNameFromType(element.type);
        return type ? "<" + type + ">" : "<...>";
      }
      const name = objectName(value);
      if (name === "Object") {
        let properties = "";
        maxLength -= 2;
        const record = value as PropsObject;
        for (let propName in record) {
          if (!hasOwn(record, propName)) {
            continue;
          }
          const propValueRaw = record[propName];
          const jsonPropName = JSON.stringify(propName);
          if (jsonPropName !== '"' + propName + '"') {
            propName = jsonPropName;
          }
          maxLength -= propName.length - 2;
          const propValue = describeValue(propValueRaw, maxLength < 15 ? maxLength : 15);
          maxLength -= propValue.length;
          if (maxLength < 0) {
            properties += properties === "" ? "..." : ", ...";
            break;
          }
          properties += (properties === "" ? "" : ",") + propName + ":" + propValue;
        }
        return "{" + properties + "}";
      } else if (enableSrcObject && (name === "Blob" || name === "File")) {
        return name + ":" + String((value as { type?: unknown }).type);
      }
      return name;
    }
    case "function": {
      const name = nameOfFunction(value);
      return name ? "function " + name : "function";
    }
    default:
      return String(value);
  }
}

function describePropValue(value: unknown, maxLength: number): string {
  if (typeof value === "string" && !needsEscaping.test(value)) {
    if (value.length > maxLength - 2) {
      if (maxLength < 5) {
        return '"..."';
      }
      return '"' + value.slice(0, maxLength - 5) + '..."';
    }
    return '"' + value + '"';
  }
  return "{" + describeValue(value, maxLength - 2) + "}";
}

function describeCollapsedElement(type: string, props: PropsObject, indent: number): string {
  // This function tries to fit the props into a single line for non-essential elements.
  // We also ignore children because we're not going deeper.
  let maxLength = maxRowLength - indent * 2 - type.length - 2;
  let content = "";
  for (const propName in props) {
    if (!hasOwn(props, propName)) {
      continue;
    }
    if (propName === "children") {
      // Ignored.
      continue;
    }
    const propValue = describePropValue(props[propName], 15);
    maxLength -= propName.length + propValue.length + 2;
    if (maxLength < 0) {
      content += " ...";
      break;
    }
    content += " " + propName + "=" + propValue;
  }
  return indentation(indent) + "<" + type + content + ">\n";
}

function describeExpandedElement(type: string, props: PropsObject, rowPrefix: string): string {
  // We add the properties to a set so we can choose later whether we'll put it on one
  // line or multiple lines.
  let remainingRowLength = maxRowLength - rowPrefix.length - type.length;
  const properties: string[] = [];
  for (const propName in props) {
    if (!hasOwn(props, propName)) {
      continue;
    }
    if (propName === "children") {
      // Ignored.
      continue;
    }
    const maxLength = maxRowLength - rowPrefix.length - propName.length - 1;
    const propValue = describePropValue(props[propName], maxLength);
    remainingRowLength -= propName.length + propValue.length + 2;
    properties.push(propName + "=" + propValue);
  }
  if (properties.length === 0) {
    return rowPrefix + "<" + type + ">\n";
  } else if (remainingRowLength > 0) {
    // We can fit all on one row.
    return rowPrefix + "<" + type + " " + properties.join(" ") + ">\n";
  }
  // Split into one row per property:
  return (
    rowPrefix +
    "<" +
    type +
    "\n" +
    rowPrefix +
    "  " +
    properties.join("\n" + rowPrefix + "  ") +
    "\n" +
    rowPrefix +
    ">\n"
  );
}

function describePropertiesDiff(clientObject: PropsObject, serverObject: PropsObject, indent: number): string {
  let properties = "";
  const remainingServerProperties: { [propName: string]: unknown } = Object.assign({}, serverObject);
  for (const propName in clientObject) {
    if (!hasOwn(clientObject, propName)) {
      continue;
    }
    delete remainingServerProperties[propName];
    const maxLength = maxRowLength - indent * 2 - propName.length - 2;
    const clientPropValue = describeValue(clientObject[propName], maxLength);
    if (hasOwn(serverObject, propName)) {
      const serverPropValue = describeValue(serverObject[propName], maxLength);
      properties += added(indent) + propName + ": " + clientPropValue + "\n";
      properties += removed(indent) + propName + ": " + serverPropValue + "\n";
    } else {
      properties += added(indent) + propName + ": " + clientPropValue + "\n";
    }
  }
  for (const propName in remainingServerProperties) {
    if (!hasOwn(remainingServerProperties, propName)) {
      continue;
    }
    const maxLength = maxRowLength - indent * 2 - propName.length - 2;
    const serverPropValue = describeValue(remainingServerProperties[propName], maxLength);
    properties += removed(indent) + propName + ": " + serverPropValue + "\n";
  }
  return properties;
}

function isTextLike(value: unknown): value is string | number | bigint {
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint";
}

function describeElementDiff(type: string, clientProps: PropsObject, serverProps: PropsObject, indent: number): string {
  let content = "";
  // Maps any previously unmatched lower case server prop name to its full prop name
  const serverPropNames: Map<string, string> = new Map();
  for (const propName in serverProps) {
    if (!hasOwn(serverProps, propName)) {
      continue;
    }
    serverPropNames.set(propName.toLowerCase(), propName);
  }

  if (serverPropNames.size === 1 && serverPropNames.has("children")) {
    content += describeExpandedElement(type, clientProps, indentation(indent));
  } else {
    for (const propName in clientProps) {
      if (!hasOwn(clientProps, propName)) {
        continue;
      }
      if (propName === "children") {
        // Handled below.
        continue;
      }
      const maxLength = maxRowLength - (indent + 1) * 2 - propName.length - 1;
      const serverPropName = serverPropNames.get(propName.toLowerCase());
      if (serverPropName !== undefined) {
        serverPropNames.delete(propName.toLowerCase());
        // There's a diff here.
        const clientValue = clientProps[propName];
        const serverValue = serverProps[serverPropName];
        const clientPropValue = describePropValue(clientValue, maxLength);
        const serverPropValue = describePropValue(serverValue, maxLength);
        if (
          typeof clientValue === "object" &&
          clientValue !== null &&
          typeof serverValue === "object" &&
          serverValue !== null &&
          objectName(clientValue) === "Object" &&
          objectName(serverValue) === "Object" &&
          // Only do the diff if the object has a lot of keys or was shortened.
          (Object.keys(clientValue).length > 2 ||
            Object.keys(serverValue).length > 2 ||
            clientPropValue.indexOf("...") > -1 ||
            serverPropValue.indexOf("...") > -1)
        ) {
          // We're comparing two plain objects. We can diff the nested objects instead.
          content +=
            indentation(indent + 1) +
            propName +
            "={{\n" +
            describePropertiesDiff(clientValue as PropsObject, serverValue as PropsObject, indent + 2) +
            indentation(indent + 1) +
            "}}\n";
        } else {
          content += added(indent + 1) + propName + "=" + clientPropValue + "\n";
          content += removed(indent + 1) + propName + "=" + serverPropValue + "\n";
        }
      } else {
        // Considered equal.
        content += indentation(indent + 1) + propName + "=" + describePropValue(clientProps[propName], maxLength) + "\n";
      }
    }

    serverPropNames.forEach((propName) => {
      if (propName === "children") {
        // Handled below.
        return;
      }
      const maxLength = maxRowLength - (indent + 1) * 2 - propName.length - 1;
      content += removed(indent + 1) + propName + "=" + describePropValue(serverProps[propName], maxLength) + "\n";
    });

    if (content === "") {
      // No properties
      content = indentation(indent) + "<" + type + ">\n";
    } else {
      // Had properties
      content = indentation(indent) + "<" + type + "\n" + content + indentation(indent) + ">\n";
    }
  }

  const serverChildren = serverProps["children"];
  const clientChildren = clientProps["children"];
  if (isTextLike(serverChildren)) {
    // There's a diff of the children.
    const serverText = "" + serverChildren;
    let clientText = "";
    if (isTextLike(clientChildren)) {
      clientText = "" + clientChildren;
    }
    content += describeTextDiff(clientText, serverText, indent + 1);
  } else if (isTextLike(clientChildren)) {
    if (serverChildren == null) {
      // This is a new string child.
      content += describeTextDiff("" + clientChildren, null, indent + 1);
    } else {
      // The client has children but it's not considered a difference from the server.
      content += describeTextDiff("" + clientChildren, undefined, indent + 1);
    }
  }
  return content;
}

function describeSiblingFiber(fiber: Fiber, indent: number): string {
  const type = describeFiberType(fiber);
  if (type === null) {
    // Skip this type of fiber. We currently treat this as a fragment
    // so it's just part of the parent's children.
    let flatContent = "";
    let childFiber = fiber.child;
    while (childFiber) {
      flatContent += describeSiblingFiber(childFiber, indent);
      childFiber = childFiber.sibling;
    }
    return flatContent;
  }
  return indentation(indent) + "<" + type + ">" + "\n";
}

function describeNode(node: HydrationDiffNode, indentIn: number): string {
  let indent = indentIn;
  const skipToNode = findNotableNode(node, indent);
  if (skipToNode !== node && (node.children.length !== 1 || node.children[0] !== skipToNode)) {
    return indentation(indent) + "...\n" + describeNode(skipToNode, indent + 1);
  }

  // Prefix with any server components for context
  let parentContent = "";
  const debugInfo = node.fiber._debugInfo;
  if (debugInfo) {
    for (let i = 0; i < debugInfo.length; i++) {
      const serverComponentName = (debugInfo[i] as { name?: unknown }).name;
      if (typeof serverComponentName === "string") {
        parentContent += indentation(indent) + "<" + serverComponentName + ">" + "\n";
        indent++;
      }
    }
  }

  // Self
  let selfContent = "";

  // We use the pending props since we might be generating a diff before the complete phase
  // when something throws.
  const clientProps = node.fiber.pendingProps;

  if (node.fiber.tag === HostText) {
    // Text Node
    selfContent = describeTextDiff(clientProps as string, node.serverProps, indent);
    indent++;
  } else {
    const type = describeFiberType(node.fiber);
    if (type !== null) {
      // Element Node
      if (node.serverProps === undefined) {
        // Just a reference node for context.
        selfContent = describeCollapsedElement(type, clientProps as PropsObject, indent);
        indent++;
      } else if (node.serverProps === null) {
        selfContent = describeExpandedElement(type, clientProps as PropsObject, added(indent));
        indent++;
      } else if (typeof node.serverProps === "string") {
        if (isDevelopment) {
          console.error("Should not have matched a non HostText fiber to a Text node. This is a bug in React.");
        }
      } else {
        selfContent = describeElementDiff(type, clientProps as PropsObject, node.serverProps, indent);
        indent++;
      }
    }
  }

  // Compute children
  let childContent = "";
  let childFiber = node.fiber.child;
  let diffIdx = 0;
  while (childFiber && diffIdx < node.children.length) {
    const childNode = node.children[diffIdx]!;
    if (childNode.fiber === childFiber) {
      // This was a match in the diff.
      childContent += describeNode(childNode, indent);
      diffIdx++;
    } else {
      // This is an unrelated previous sibling.
      childContent += describeSiblingFiber(childFiber, indent);
    }
    childFiber = childFiber.sibling;
  }

  if (childFiber && node.children.length > 0) {
    // If we had any further siblings after the last mismatch, we can't be sure if it's
    // actually a valid match since it might not have found a match. So we exclude next
    // siblings to avoid confusion.
    childContent += indentation(indent) + "..." + "\n";
  }

  // Deleted tail nodes
  const serverTail = node.serverTail;
  if (node.serverProps === null) {
    indent--;
  }
  for (let i = 0; i < serverTail.length; i++) {
    const tailNode = serverTail[i]!;
    if (typeof tailNode === "string") {
      // Removed text node
      childContent += removed(indent) + describeTextNode(tailNode, maxRowLength - indent * 2) + "\n";
    } else {
      // Removed element
      childContent += describeExpandedElement(tailNode.type, tailNode.props, removed(indent));
    }
  }

  return parentContent + selfContent + childContent;
}

export function describeDiff(rootNode: HydrationDiffNode): string {
  try {
    return "\n\n" + describeNode(rootNode, 0);
  } catch {
    return "";
  }
}
