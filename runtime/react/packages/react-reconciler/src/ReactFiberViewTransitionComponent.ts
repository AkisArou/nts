import type { Instance, ViewTransitionInstance } from "./ReactFiberConfig.ts";
import { getCommittingRoot, getPendingTransitionTypes } from "./ReactFiberWorkLoop.ts";
import type { FiberRoot } from "./ReactInternalTypes.ts";

export type ViewTransitionClassPerType = { [transitionType: string]: "none" | "auto" | string };

export type ViewTransitionClass = "none" | "auto" | string | ViewTransitionClassPerType;

type ViewTransitionEventHandler = (instance: ViewTransitionInstance, types: string[]) => void | (() => void);

export interface ViewTransitionProps {
  name?: string;
  children?: unknown;
  default?: ViewTransitionClass;
  enter?: ViewTransitionClass;
  exit?: ViewTransitionClass;
  share?: ViewTransitionClass;
  update?: ViewTransitionClass;
  parentEnter?: ViewTransitionClass;
  parentExit?: ViewTransitionClass;
  onEnter?: ViewTransitionEventHandler;
  onExit?: ViewTransitionEventHandler;
  onParentEnter?: ViewTransitionEventHandler;
  onParentExit?: ViewTransitionEventHandler;
  onShare?: ViewTransitionEventHandler;
  onUpdate?: ViewTransitionEventHandler;
}

export interface ViewTransitionState {
  // The view-transition-name to use when an explicit one is not specified.
  autoName: string | null;
  // A temporary state during the commit phase if we have paired this with
  // another instance.
  paired: ViewTransitionState | null;
  // A temporary state during the apply gesture phase if we cloned this
  // boundary.
  clones: Instance[] | null;
  // The current ref instance. This can change through the lifetime of the
  // instance.
  ref: ViewTransitionInstance | null;
}

let globalClientIdCounter = 0;

export function getViewTransitionName(props: ViewTransitionProps, instance: ViewTransitionState): string {
  if (props.name != null && props.name !== "auto") {
    return props.name;
  }
  if (instance.autoName !== null) {
    return instance.autoName;
  }
  // We assume we always call this in the commit phase.
  const root = getCommittingRoot() as FiberRoot;
  const identifierPrefix = root.identifierPrefix;
  const globalClientId = globalClientIdCounter++;
  const name = "_" + identifierPrefix + "t_" + globalClientId.toString(32) + "_";
  instance.autoName = name;
  return name;
}

function getClassNameByType(classByType: ViewTransitionClass | null | undefined): string | null | undefined {
  if (classByType == null || typeof classByType === "string") {
    return classByType;
  }
  let className: string | null = null;
  const activeTypes = getPendingTransitionTypes();
  if (activeTypes !== null) {
    for (let i = 0; i < activeTypes.length; i++) {
      const match = classByType[activeTypes[i]!];
      if (match != null) {
        if (match === "none") {
          // If anything matches "none" that takes precedence over any other
          // type that also matches.
          return "none";
        }
        if (className == null) {
          className = match;
        } else {
          className += " " + match;
        }
      }
    }
  }
  if (className == null) {
    // We had no other matches. Match the default for this configuration.
    return classByType["default"];
  }
  return className;
}

export function getViewTransitionClassName(
  defaultClass: ViewTransitionClass | null | undefined,
  eventClass: ViewTransitionClass | null | undefined,
): string | null | undefined {
  const className = getClassNameByType(defaultClass);
  const eventClassName = getClassNameByType(eventClass);
  if (eventClassName == null) {
    return className === "auto" ? null : className;
  }
  if (eventClassName === "auto") {
    return null;
  }
  return eventClassName;
}
