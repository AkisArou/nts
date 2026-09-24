import { REACT_MEMO_TYPE } from "shared/ReactSymbols.ts";
import type { MemoComponent, Props } from "shared/ReactTypes.ts";
import { isDevelopment } from "shared/Build.ts";

export function memo(type: unknown, compare?: (oldProps: Props, newProps: Props) => boolean): MemoComponent {
  if (isDevelopment && type == null) {
    console.error(
      "memo: The first argument must be a component. Instead " + "received: %s",
      type === null ? "null" : typeof type,
    );
  }
  const elementType: MemoComponent = {
    $$typeof: REACT_MEMO_TYPE,
    type,
    compare: compare === undefined ? null : compare,
  };
  if (isDevelopment) {
    defineInheritedDisplayName(elementType, type);
  }
  return elementType;
}

// In development, naming the wrapper also names an anonymous inner function,
// so that component stacks show a useful frame for `memo(() => ...)`.
export function defineInheritedDisplayName(wrapper: object, inner: unknown): void {
  let ownName: unknown;
  Object.defineProperty(wrapper, "displayName", {
    enumerable: false,
    configurable: true,
    get() {
      return ownName;
    },
    set(name: unknown) {
      ownName = name;
      if (typeof inner === "function" || (typeof inner === "object" && inner !== null)) {
        const named = inner as { name?: unknown; displayName?: unknown };
        if (!named.name && !named.displayName) {
          Object.defineProperty(inner, "name", { value: name });
          named.displayName = name;
        }
      }
    },
  });
}
