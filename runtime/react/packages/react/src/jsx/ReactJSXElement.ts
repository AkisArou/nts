// Element creation: `createElement`, the automatic JSX runtime (`jsx`,
// `jsxs`, `jsxDEV`) and `cloneElement`.
//
// An element is a plain object with `$$typeof`, `type`, `key`, `ref` and
// `props`. In development it also carries its owner and debug stack, `ref`
// becomes a warning getter, and the element and its props are frozen.

import { isDevelopment } from "shared/Build.ts";
import { checkKeyStringCoercion } from "shared/CheckStringCoercion.ts";
import { getComponentNameFromType } from "shared/getComponentNameFromType.ts";
import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE, REACT_LAZY_TYPE } from "shared/ReactSymbols.ts";
import type { LazyComponent, Props, ReactElement, ReactKey } from "shared/ReactTypes.ts";
import { ReactSharedInternals } from "../ReactSharedInternals.ts";

// How many elements record where they were created before later ones share
// a placeholder stack. Owner stacks are a development aid with a cost.
const ownerStackLimit = 1e4;
const ownerStackTraceLimit = 10;

interface ConsoleWithTasks {
  createTask?: (name: string) => unknown;
}

const createTask: (name: string) => unknown =
  isDevelopment && typeof (console as ConsoleWithTasks).createTask === "function"
    ? (name) => (console as ConsoleWithTasks).createTask!(name)
    : () => null;

function getTaskName(type: unknown): string {
  if (type === REACT_FRAGMENT_TYPE) {
    return "<>";
  }
  if (typeof type === "object" && type !== null && (type as { $$typeof?: unknown }).$$typeof === REACT_LAZY_TYPE) {
    // Resolving a lazy here could trigger its load.
    return "<...>";
  }
  try {
    const name = getComponentNameFromType(type);
    return name ? "<" + name + ">" : "<...>";
  } catch {
    return "<...>";
  }
}

function getOwner(): unknown {
  if (isDevelopment) {
    const dispatcher = ReactSharedInternals.A;
    if (dispatcher === null || dispatcher.getOwner === undefined) {
      return null;
    }
    return dispatcher.getOwner();
  }
  return null;
}

// The stack shared by elements created past the owner stack limit. It is
// shaped like a real one: a top frame, then React's bottom frame, so that
// formatting it yields an empty owner stack rather than React's internals.
function UnknownOwner(): Error {
  return (() => Error("react-stack-top-frame"))();
}
const createFakeCallStack = {
  react_stack_bottom_frame(callStackForError: () => Error): Error {
    return callStackForError();
  },
};

let unknownOwnerDebugStack: unknown = null;
let unknownOwnerDebugTask: unknown = null;
if (isDevelopment) {
  unknownOwnerDebugStack = createFakeCallStack.react_stack_bottom_frame.bind(createFakeCallStack, UnknownOwner)();
  unknownOwnerDebugTask = createTask(getTaskName(UnknownOwner));
}

type ErrorWithStackTraceLimit = ErrorConstructor & { stackTraceLimit?: number };

// Whether this element records where it was created. Past the limit,
// elements share the unknown owner's stack.
function shouldTrackActualOwner(): boolean {
  return ReactSharedInternals.recentlyCreatedOwnerStacks++ < ownerStackLimit;
}

// Every development entry point below creates its `react-stack-top-frame`
// error in its own frame, not in a helper: formatting an owner stack drops
// exactly one frame, the JSX call's.

let specialPropKeyWarningShown = false;
let didWarnAboutOldJSXRuntime = false;
const didWarnAboutElementRef: { [componentName: string]: boolean } = {};
const didWarnAboutKeySpread: { [warningKey: string]: boolean } = {};

type WarningGetter = (() => unknown) & { isReactWarning?: boolean };

function isWarningGetter(config: object, name: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(config, name);
  const getter = descriptor === undefined ? undefined : (descriptor.get as WarningGetter | undefined);
  return getter !== undefined && getter.isReactWarning === true;
}

function hasValidRef(config: Props): boolean {
  if (isDevelopment && Object.prototype.hasOwnProperty.call(config, "ref") && isWarningGetter(config, "ref")) {
    return false;
  }
  return config["ref"] !== undefined;
}

function hasValidKey(config: Props): boolean {
  if (isDevelopment && Object.prototype.hasOwnProperty.call(config, "key") && isWarningGetter(config, "key")) {
    return false;
  }
  return config["key"] !== undefined;
}

function defineKeyPropWarningGetter(props: Props, displayName: unknown): void {
  const warnAboutAccessingKey: WarningGetter = () => {
    if (!specialPropKeyWarningShown) {
      specialPropKeyWarningShown = true;
      console.error(
        "%s: `key` is not a prop. Trying to access it will result " +
          "in `undefined` being returned. If you need to access the same " +
          "value within the child component, you should pass it as a different " +
          "prop. (https://react.dev/link/special-props)",
        displayName,
      );
    }
    return undefined;
  };
  warnAboutAccessingKey.isReactWarning = true;
  Object.defineProperty(props, "key", { get: warnAboutAccessingKey, configurable: true });
}

function elementRefGetterWithDeprecationWarning(this: ReactElement): unknown {
  const componentName = getComponentNameFromType(this.type) ?? "null";
  if (!didWarnAboutElementRef[componentName]) {
    didWarnAboutElementRef[componentName] = true;
    console.error(
      "Accessing element.ref was removed in React 19. ref is now a " +
        "regular prop. It will be removed from the JSX Element " +
        "type in a future release.",
    );
  }
  const refProp = this.props["ref"];
  return refProp !== undefined ? refProp : null;
}

function displayNameForKeyWarning(type: unknown): unknown {
  if (typeof type === "function") {
    const named = type as { displayName?: unknown; name?: unknown };
    return named.displayName || named.name || "Unknown";
  }
  return type;
}

// The key an element gets from `maybeKey` and `config.key`, which wins.
function resolveKey(maybeKey: unknown, config: Props): ReactKey {
  let key: ReactKey = null;
  if (maybeKey !== undefined) {
    if (isDevelopment) {
      checkKeyStringCoercion(maybeKey);
    }
    key = "" + (maybeKey as string);
  }
  if (hasValidKey(config)) {
    if (isDevelopment) {
      checkKeyStringCoercion(config["key"]);
    }
    key = "" + (config["key"] as string);
  }
  return key;
}

// `key` is not a prop: when the config has one, props are a copy without it.
function propsWithoutKey(config: Props): Props {
  if (!("key" in config)) {
    return config;
  }
  const props: Props = {};
  for (const propName in config) {
    if (propName !== "key") {
      props[propName] = config[propName];
    }
  }
  return props;
}

function ReactElementOf(
  type: unknown,
  key: ReactKey,
  props: Props,
  owner: unknown,
  debugStack: unknown,
  debugTask: unknown,
): ReactElement {
  // `ref` is an ordinary prop now; the element field mirrors it.
  const refProp = props["ref"];
  const ref = refProp !== undefined ? refProp : null;
  if (!isDevelopment) {
    return { $$typeof: REACT_ELEMENT_TYPE, type, key, ref, props };
  }
  const element = { $$typeof: REACT_ELEMENT_TYPE, type, key, props, _owner: owner } as Omit<ReactElement, "ref"> &
    ReactElement;
  if (ref !== null) {
    Object.defineProperty(element, "ref", { enumerable: false, get: elementRefGetterWithDeprecationWarning });
  } else {
    // A plain property keeps `element.ref` null without a warning when no ref
    // was passed, and hides it from equality checks in tests.
    Object.defineProperty(element, "ref", { enumerable: false, value: null });
  }
  element._store = { validated: 0 };
  Object.defineProperty(element._store, "validated", {
    configurable: false,
    enumerable: false,
    writable: true,
    value: 0,
  });
  Object.defineProperty(element, "_debugInfo", { configurable: false, enumerable: false, writable: true, value: null });
  Object.defineProperty(element, "_debugStack", {
    configurable: false,
    enumerable: false,
    writable: true,
    value: debugStack,
  });
  Object.defineProperty(element, "_debugTask", {
    configurable: false,
    enumerable: false,
    writable: true,
    value: debugTask,
  });
  Object.freeze(element.props);
  Object.freeze(element);
  return element;
}

export function jsxProd(type: unknown, config: Props, maybeKey?: unknown): ReactElement {
  const key = resolveKey(maybeKey, config);
  return ReactElementOf(type, key, propsWithoutKey(config), getOwner(), undefined, undefined);
}

function jsxProdSignatureRunningInDevWithDynamicChildren(type: unknown, config: Props, maybeKey?: unknown): ReactElement {
  const trackActualOwner = shouldTrackActualOwner();
  let debugStack: unknown = unknownOwnerDebugStack;
  if (trackActualOwner) {
    const errorConstructor = Error as ErrorWithStackTraceLimit;
    const previousStackTraceLimit = errorConstructor.stackTraceLimit;
    errorConstructor.stackTraceLimit = ownerStackTraceLimit;
    debugStack = Error("react-stack-top-frame");
    errorConstructor.stackTraceLimit = previousStackTraceLimit;
  }
  return jsxDEVImpl(
    type,
    config,
    maybeKey,
    false,
    debugStack,
    trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask,
  );
}

function jsxProdSignatureRunningInDevWithStaticChildren(type: unknown, config: Props, maybeKey?: unknown): ReactElement {
  const trackActualOwner = shouldTrackActualOwner();
  let debugStack: unknown = unknownOwnerDebugStack;
  if (trackActualOwner) {
    const errorConstructor = Error as ErrorWithStackTraceLimit;
    const previousStackTraceLimit = errorConstructor.stackTraceLimit;
    errorConstructor.stackTraceLimit = ownerStackTraceLimit;
    debugStack = Error("react-stack-top-frame");
    errorConstructor.stackTraceLimit = previousStackTraceLimit;
  }
  return jsxDEVImpl(
    type,
    config,
    maybeKey,
    true,
    debugStack,
    trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask,
  );
}

// `jsx` and `jsxs` as the automatic runtime exports them. In development the
// production signature still validates, as upstream does.
export const jsx: (type: unknown, config: Props, maybeKey?: unknown) => ReactElement = isDevelopment
  ? jsxProdSignatureRunningInDevWithDynamicChildren
  : jsxProd;

export const jsxs: (type: unknown, config: Props, maybeKey?: unknown) => ReactElement = isDevelopment
  ? jsxProdSignatureRunningInDevWithStaticChildren
  : jsxProd;

export function jsxDEV(
  type: unknown,
  config: Props,
  maybeKey: unknown,
  isStaticChildren: boolean,
): ReactElement {
  const trackActualOwner = shouldTrackActualOwner();
  let debugStack: unknown = unknownOwnerDebugStack;
  if (trackActualOwner) {
    const errorConstructor = Error as ErrorWithStackTraceLimit;
    const previousStackTraceLimit = errorConstructor.stackTraceLimit;
    errorConstructor.stackTraceLimit = ownerStackTraceLimit;
    debugStack = Error("react-stack-top-frame");
    errorConstructor.stackTraceLimit = previousStackTraceLimit;
  }
  return jsxDEVImpl(
    type,
    config,
    maybeKey,
    isStaticChildren,
    debugStack,
    trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask,
  );
}

function jsxDEVImpl(
  type: unknown,
  config: Props,
  maybeKey: unknown,
  isStaticChildren: boolean,
  debugStack: unknown,
  debugTask: unknown,
): ReactElement {
  const children = config["children"];
  if (children !== undefined) {
    if (isStaticChildren) {
      if (Array.isArray(children)) {
        for (let i = 0; i < children.length; i++) {
          validateChildKeys(children[i]);
        }
        Object.freeze(children);
      } else {
        console.error(
          "React.jsx: Static children should always be an array. " +
            "You are likely explicitly calling React.jsxs or React.jsxDEV. " +
            "Use the Babel transform instead.",
        );
      }
    } else {
      validateChildKeys(children);
    }
  }

  // A `key` in a spread props object is a mistake: React keys must be passed
  // directly.
  if (Object.prototype.hasOwnProperty.call(config, "key")) {
    const componentName = getComponentNameFromType(type);
    const keys = Object.keys(config).filter((k) => k !== "key");
    const beforeExample = keys.length > 0 ? "{key: someKey, " + keys.join(": ..., ") + ": ...}" : "{key: someKey}";
    if (!didWarnAboutKeySpread[componentName + beforeExample]) {
      const afterExample = keys.length > 0 ? "{" + keys.join(": ..., ") + ": ...}" : "{}";
      console.error(
        'A props object containing a "key" prop is being spread into JSX:\n' +
          "  let props = %s;\n" +
          "  <%s {...props} />\n" +
          "React keys must be passed directly to JSX without using spread:\n" +
          "  let props = %s;\n" +
          "  <%s key={someKey} {...props} />",
        beforeExample,
        componentName,
        afterExample,
        componentName,
      );
      didWarnAboutKeySpread[componentName + beforeExample] = true;
    }
  }

  const key = resolveKey(maybeKey, config);
  const props = propsWithoutKey(config);
  if (key) {
    defineKeyPropWarningGetter(props, displayNameForKeyWarning(type));
  }
  return ReactElementOf(type, key, props, getOwner(), debugStack, debugTask);
}

export function createElement(type: unknown, config?: Props | null, ...children: unknown[]): ReactElement {
  if (isDevelopment) {
    for (const child of children) {
      validateChildKeys(child);
    }
  }
  const props: Props = {};
  let key: ReactKey = null;
  if (config != null) {
    if (
      isDevelopment &&
      !didWarnAboutOldJSXRuntime &&
      "__self" in config &&
      // Only the old transform passes `__self` without `key`.
      !("key" in config)
    ) {
      didWarnAboutOldJSXRuntime = true;
      console.warn(
        "Your app (or one of its dependencies) is using an outdated JSX " +
          "transform. Update to the modern JSX transform for " +
          "faster performance: https://react.dev/link/new-jsx-transform",
      );
    }
    if (hasValidKey(config)) {
      if (isDevelopment) {
        checkKeyStringCoercion(config["key"]);
      }
      key = "" + (config["key"] as string);
    }
    for (const propName in config) {
      if (
        Object.prototype.hasOwnProperty.call(config, propName) &&
        propName !== "key" &&
        // The old JSX transform's source annotations are not props.
        propName !== "__self" &&
        propName !== "__source"
      ) {
        props[propName] = config[propName];
      }
    }
  }
  if (children.length === 1) {
    props["children"] = children[0];
  } else if (children.length > 1) {
    if (isDevelopment) {
      Object.freeze(children);
    }
    props["children"] = children;
  }
  // Class components still resolve default props here.
  const defaultProps = defaultPropsOf(type);
  if (defaultProps !== null) {
    for (const propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
  }
  if (isDevelopment && key) {
    defineKeyPropWarningGetter(props, displayNameForKeyWarning(type));
  }
  if (!isDevelopment) {
    return ReactElementOf(type, key, props, getOwner(), undefined, undefined);
  }
  const trackActualOwner = shouldTrackActualOwner();
  let debugStack: unknown = unknownOwnerDebugStack;
  if (trackActualOwner) {
    const errorConstructor = Error as ErrorWithStackTraceLimit;
    const previousStackTraceLimit = errorConstructor.stackTraceLimit;
    errorConstructor.stackTraceLimit = ownerStackTraceLimit;
    debugStack = Error("react-stack-top-frame");
    errorConstructor.stackTraceLimit = previousStackTraceLimit;
  }
  return ReactElementOf(
    type,
    key,
    props,
    getOwner(),
    debugStack,
    trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask,
  );
}

function defaultPropsOf(type: unknown): Props | null {
  if ((typeof type === "function" || typeof type === "object") && type !== null) {
    const defaultProps = (type as { defaultProps?: unknown }).defaultProps;
    if (typeof defaultProps === "object" && defaultProps !== null) {
      return defaultProps as Props;
    }
  }
  return null;
}

export function cloneAndReplaceKey(oldElement: ReactElement, newKey: ReactKey): ReactElement {
  const clonedElement = ReactElementOf(
    oldElement.type,
    newKey,
    oldElement.props,
    isDevelopment ? oldElement._owner : undefined,
    isDevelopment ? oldElement._debugStack : undefined,
    isDevelopment ? oldElement._debugTask : undefined,
  );
  if (isDevelopment && oldElement._store !== undefined && clonedElement._store !== undefined) {
    clonedElement._store.validated = oldElement._store.validated;
  }
  return clonedElement;
}

export function cloneElement(element: ReactElement | null | undefined, config?: Props | null, ...children: unknown[]): ReactElement {
  if (element === null || element === undefined) {
    throw new Error(`The argument must be a React element, but you passed ${element}.`);
  }
  const props: Props = Object.assign({}, element.props);
  let key = element.key;
  let owner = isDevelopment ? element._owner : undefined;
  if (config != null) {
    if (hasValidRef(config)) {
      owner = isDevelopment ? getOwner() : undefined;
    }
    if (hasValidKey(config)) {
      if (isDevelopment) {
        checkKeyStringCoercion(config["key"]);
      }
      key = "" + (config["key"] as string);
    }
    for (const propName in config) {
      if (
        Object.prototype.hasOwnProperty.call(config, propName) &&
        propName !== "key" &&
        propName !== "__self" &&
        propName !== "__source" &&
        // An undefined ref keeps the element's current one.
        !(propName === "ref" && config["ref"] === undefined)
      ) {
        props[propName] = config[propName];
      }
    }
  }
  if (children.length === 1) {
    props["children"] = children[0];
  } else if (children.length > 1) {
    props["children"] = children;
  }
  const clonedElement = ReactElementOf(
    element.type,
    key,
    props,
    owner,
    isDevelopment ? element._debugStack : undefined,
    isDevelopment ? element._debugTask : undefined,
  );
  for (const child of children) {
    validateChildKeys(child);
  }
  return clonedElement;
}

// Marks a child passed in a static position as validated, so the
// reconciler does not warn that it lacks a key.
function validateChildKeys(node: unknown): void {
  if (!isDevelopment) {
    return;
  }
  if (isValidElement(node)) {
    if (node._store !== undefined) {
      node._store.validated = 1;
    }
  } else if (isLazyType(node)) {
    const payload = node._payload as { status?: unknown; value?: unknown };
    if (payload.status === "fulfilled") {
      if (isValidElement(payload.value) && payload.value._store !== undefined) {
        payload.value._store.validated = 1;
      }
    } else if (node._store !== undefined) {
      node._store.validated = 1;
    }
  }
}

export function isValidElement(object: unknown): object is ReactElement {
  return (
    typeof object === "object" && object !== null && (object as { $$typeof?: unknown }).$$typeof === REACT_ELEMENT_TYPE
  );
}

export function isLazyType(object: unknown): object is LazyComponent<unknown, unknown> {
  return (
    typeof object === "object" && object !== null && (object as { $$typeof?: unknown }).$$typeof === REACT_LAZY_TYPE
  );
}
