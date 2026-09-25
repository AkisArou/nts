// Development warnings about deprecated class lifecycles and legacy context,
// collected during a render and flushed once per commit, deduplicated per
// component type. In production every method does nothing.

import { defines } from "react-reconciler/ReactFiberClassComponentHost.ts";
import { ComponentWillMount, ComponentWillReceiveProps, ComponentWillUpdate, GetChildContext, UnsafeComponentWillMount, UnsafeComponentWillReceiveProps, UnsafeComponentWillUpdate } from "shared/ReactClassComponentType.ts";
import { isDevelopment } from "shared/Build.ts";
import { runWithFiberInDEV } from "./ReactCurrentFiber.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import { StrictLegacyMode } from "./ReactTypeOfMode.ts";
import { getComponentNameFromFiber } from "./getComponentNameFromFiber.ts";

type FiberArray = Fiber[];
type FiberToFiberComponentsMap = Map<Fiber, FiberArray>;

// A lifecycle a polyfill may mark as intentional.
type Lifecycle = ((...args: never[]) => unknown) & { __suppressDeprecationWarning?: boolean };

// The class instance members these warnings inspect.
interface LegacyLifecycles {
  componentWillMount: Lifecycle;
  UNSAFE_componentWillMount: Lifecycle;
  componentWillReceiveProps: Lifecycle;
  UNSAFE_componentWillReceiveProps: Lifecycle;
  componentWillUpdate: Lifecycle;
  UNSAFE_componentWillUpdate: Lifecycle;
  getChildContext?: unknown;
}

// A class component's legacy context declarations.
interface LegacyContextType {
  contextTypes?: unknown;
  childContextTypes?: unknown;
}

function findStrictRoot(fiber: Fiber): Fiber | null {
  let maybeStrictRoot: Fiber | null = null;

  let node: Fiber | null = fiber;
  while (node !== null) {
    if (node.mode & StrictLegacyMode) {
      maybeStrictRoot = node;
    }
    node = node.return;
  }

  return maybeStrictRoot;
}

function setToSortedString(set: Set<string>): string {
  const array: string[] = [];
  set.forEach((value) => {
    array.push(value);
  });
  return array.sort().join(", ");
}

let pendingComponentWillMountWarnings: Fiber[] = [];
let pendingUNSAFE_ComponentWillMountWarnings: Fiber[] = [];
let pendingComponentWillReceivePropsWarnings: Fiber[] = [];
let pendingUNSAFE_ComponentWillReceivePropsWarnings: Fiber[] = [];
let pendingComponentWillUpdateWarnings: Fiber[] = [];
let pendingUNSAFE_ComponentWillUpdateWarnings: Fiber[] = [];

// Tracks components we have already warned about.
const didWarnAboutUnsafeLifecycles = new Set<unknown>();

function recordUnsafeLifecycleWarnings(fiber: Fiber, instance: LegacyLifecycles): void {
  if (!isDevelopment) {
    return;
  }
  // Dedupe strategy: Warn once per component.
  if (didWarnAboutUnsafeLifecycles.has(fiber.type)) {
    return;
  }

  if (
    defines(fiber.type, instance, ComponentWillMount) &&
    // Don't warn about react-lifecycles-compat polyfilled components.
    instance.componentWillMount.__suppressDeprecationWarning !== true
  ) {
    pendingComponentWillMountWarnings.push(fiber);
  }

  if (fiber.mode & StrictLegacyMode && defines(fiber.type, instance, UnsafeComponentWillMount)) {
    pendingUNSAFE_ComponentWillMountWarnings.push(fiber);
  }

  if (
    defines(fiber.type, instance, ComponentWillReceiveProps) &&
    instance.componentWillReceiveProps.__suppressDeprecationWarning !== true
  ) {
    pendingComponentWillReceivePropsWarnings.push(fiber);
  }

  if (fiber.mode & StrictLegacyMode && defines(fiber.type, instance, UnsafeComponentWillReceiveProps)) {
    pendingUNSAFE_ComponentWillReceivePropsWarnings.push(fiber);
  }

  if (
    defines(fiber.type, instance, ComponentWillUpdate) &&
    instance.componentWillUpdate.__suppressDeprecationWarning !== true
  ) {
    pendingComponentWillUpdateWarnings.push(fiber);
  }

  if (fiber.mode & StrictLegacyMode && defines(fiber.type, instance, UnsafeComponentWillUpdate)) {
    pendingUNSAFE_ComponentWillUpdateWarnings.push(fiber);
  }
}

// Collects the component names of `pending` and marks their types warned.
function collectNames(pending: Fiber[]): Set<string> {
  const names = new Set<string>();
  pending.forEach((fiber) => {
    names.add(getComponentNameFromFiber(fiber) || "Component");
    didWarnAboutUnsafeLifecycles.add(fiber.type);
  });
  return names;
}

function flushPendingUnsafeLifecycleWarnings(): void {
  if (!isDevelopment) {
    return;
  }
  // We do an initial pass to gather component names
  const componentWillMountUniqueNames = collectNames(pendingComponentWillMountWarnings);
  pendingComponentWillMountWarnings = [];

  const UNSAFE_componentWillMountUniqueNames = collectNames(pendingUNSAFE_ComponentWillMountWarnings);
  pendingUNSAFE_ComponentWillMountWarnings = [];

  const componentWillReceivePropsUniqueNames = collectNames(pendingComponentWillReceivePropsWarnings);
  pendingComponentWillReceivePropsWarnings = [];

  const UNSAFE_componentWillReceivePropsUniqueNames = collectNames(pendingUNSAFE_ComponentWillReceivePropsWarnings);
  pendingUNSAFE_ComponentWillReceivePropsWarnings = [];

  const componentWillUpdateUniqueNames = collectNames(pendingComponentWillUpdateWarnings);
  pendingComponentWillUpdateWarnings = [];

  const UNSAFE_componentWillUpdateUniqueNames = collectNames(pendingUNSAFE_ComponentWillUpdateWarnings);
  pendingUNSAFE_ComponentWillUpdateWarnings = [];

  // Finally, we flush all the warnings
  // UNSAFE_ ones before the deprecated ones, since they'll be 'louder'
  if (UNSAFE_componentWillMountUniqueNames.size > 0) {
    const sortedNames = setToSortedString(UNSAFE_componentWillMountUniqueNames);
    console.error(
      "Using UNSAFE_componentWillMount in strict mode is not recommended and may indicate bugs in your code. " +
        "See https://react.dev/link/unsafe-component-lifecycles for details.\n\n" +
        "* Move code with side effects to componentDidMount, and set initial state in the constructor.\n" +
        "\nPlease update the following components: %s",
      sortedNames,
    );
  }

  if (UNSAFE_componentWillReceivePropsUniqueNames.size > 0) {
    const sortedNames = setToSortedString(UNSAFE_componentWillReceivePropsUniqueNames);
    console.error(
      "Using UNSAFE_componentWillReceiveProps in strict mode is not recommended " +
        "and may indicate bugs in your code. " +
        "See https://react.dev/link/unsafe-component-lifecycles for details.\n\n" +
        "* Move data fetching code or side effects to componentDidUpdate.\n" +
        "* If you're updating state whenever props change, " +
        "refactor your code to use memoization techniques or move it to " +
        "static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state\n" +
        "\nPlease update the following components: %s",
      sortedNames,
    );
  }

  if (UNSAFE_componentWillUpdateUniqueNames.size > 0) {
    const sortedNames = setToSortedString(UNSAFE_componentWillUpdateUniqueNames);
    console.error(
      "Using UNSAFE_componentWillUpdate in strict mode is not recommended " +
        "and may indicate bugs in your code. " +
        "See https://react.dev/link/unsafe-component-lifecycles for details.\n\n" +
        "* Move data fetching code or side effects to componentDidUpdate.\n" +
        "\nPlease update the following components: %s",
      sortedNames,
    );
  }

  if (componentWillMountUniqueNames.size > 0) {
    const sortedNames = setToSortedString(componentWillMountUniqueNames);

    console.warn(
      "componentWillMount has been renamed, and is not recommended for use. " +
        "See https://react.dev/link/unsafe-component-lifecycles for details.\n\n" +
        "* Move code with side effects to componentDidMount, and set initial state in the constructor.\n" +
        "* Rename componentWillMount to UNSAFE_componentWillMount to suppress " +
        "this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. " +
        "To rename all deprecated lifecycles to their new names, you can run " +
        "`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n" +
        "\nPlease update the following components: %s",
      sortedNames,
    );
  }

  if (componentWillReceivePropsUniqueNames.size > 0) {
    const sortedNames = setToSortedString(componentWillReceivePropsUniqueNames);

    console.warn(
      "componentWillReceiveProps has been renamed, and is not recommended for use. " +
        "See https://react.dev/link/unsafe-component-lifecycles for details.\n\n" +
        "* Move data fetching code or side effects to componentDidUpdate.\n" +
        "* If you're updating state whenever props change, refactor your " +
        "code to use memoization techniques or move it to " +
        "static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state\n" +
        "* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress " +
        "this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. " +
        "To rename all deprecated lifecycles to their new names, you can run " +
        "`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n" +
        "\nPlease update the following components: %s",
      sortedNames,
    );
  }

  if (componentWillUpdateUniqueNames.size > 0) {
    const sortedNames = setToSortedString(componentWillUpdateUniqueNames);

    console.warn(
      "componentWillUpdate has been renamed, and is not recommended for use. " +
        "See https://react.dev/link/unsafe-component-lifecycles for details.\n\n" +
        "* Move data fetching code or side effects to componentDidUpdate.\n" +
        "* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress " +
        "this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. " +
        "To rename all deprecated lifecycles to their new names, you can run " +
        "`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n" +
        "\nPlease update the following components: %s",
      sortedNames,
    );
  }
}

let pendingLegacyContextWarning: FiberToFiberComponentsMap = new Map<Fiber, FiberArray>();

// Tracks components we have already warned about.
const didWarnAboutLegacyContext = new Set<unknown>();

function recordLegacyContextWarning(fiber: Fiber, instance: LegacyLifecycles | null): void {
  if (!isDevelopment) {
    return;
  }
  const strictRoot = findStrictRoot(fiber);
  if (strictRoot === null) {
    console.error(
      "Expected to find a StrictMode component in a strict mode tree. " +
        "This error is likely caused by a bug in React. Please file an issue.",
    );
    return;
  }

  // Dedup strategy: Warn once per component.
  if (didWarnAboutLegacyContext.has(fiber.type)) {
    return;
  }

  let warningsForRoot = pendingLegacyContextWarning.get(strictRoot);
  const type = fiber.type as LegacyContextType;

  if (
    type.contextTypes != null ||
    type.childContextTypes != null ||
    (instance !== null && defines(fiber.type, instance, GetChildContext))
  ) {
    if (warningsForRoot === undefined) {
      warningsForRoot = [];
      pendingLegacyContextWarning.set(strictRoot, warningsForRoot);
    }
    warningsForRoot.push(fiber);
  }
}

function flushLegacyContextWarning(): void {
  if (!isDevelopment) {
    return;
  }
  pendingLegacyContextWarning.forEach((fiberArray: FiberArray) => {
    if (fiberArray.length === 0) {
      return;
    }
    const firstFiber = fiberArray[0]!;

    const uniqueNames = new Set<string>();
    fiberArray.forEach((fiber) => {
      uniqueNames.add(getComponentNameFromFiber(fiber) || "Component");
      didWarnAboutLegacyContext.add(fiber.type);
    });

    const sortedNames = setToSortedString(uniqueNames);

    runWithFiberInDEV(firstFiber, () => {
      console.error(
        "Legacy context API has been detected within a strict-mode tree." +
          "\n\nThe old API will be supported in all 16.x releases, but applications " +
          "using it should migrate to the new version." +
          "\n\nPlease update the following components: %s" +
          "\n\nLearn more about this warning here: https://react.dev/link/legacy-context",
        sortedNames,
      );
    });
  });
}

function discardPendingWarnings(): void {
  if (!isDevelopment) {
    return;
  }
  pendingComponentWillMountWarnings = [];
  pendingUNSAFE_ComponentWillMountWarnings = [];
  pendingComponentWillReceivePropsWarnings = [];
  pendingUNSAFE_ComponentWillReceivePropsWarnings = [];
  pendingComponentWillUpdateWarnings = [];
  pendingUNSAFE_ComponentWillUpdateWarnings = [];
  pendingLegacyContextWarning = new Map<Fiber, FiberArray>();
}

export const ReactStrictModeWarnings = {
  recordUnsafeLifecycleWarnings,
  flushPendingUnsafeLifecycleWarnings,
  recordLegacyContextWarning,
  flushLegacyContextWarning,
  discardPendingWarnings,
};

export default ReactStrictModeWarnings;
