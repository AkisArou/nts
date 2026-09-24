import { REACT_FORWARD_REF_TYPE, REACT_MEMO_TYPE } from "shared/ReactSymbols.ts";
import type { ForwardRefComponent, Props } from "shared/ReactTypes.ts";
import { isDevelopment } from "shared/Build.ts";
import { defineInheritedDisplayName } from "./ReactMemo.ts";

export function forwardRef(render: (props: Props, ref: unknown) => unknown): ForwardRefComponent {
  if (isDevelopment) {
    const renderValue: unknown = render;
    if (renderValue != null && (renderValue as { $$typeof?: unknown }).$$typeof === REACT_MEMO_TYPE) {
      console.error(
        "forwardRef requires a render function but received a `memo` " +
          "component. Instead of forwardRef(memo(...)), use " +
          "memo(forwardRef(...)).",
      );
    } else if (typeof renderValue !== "function") {
      console.error(
        "forwardRef requires a render function but was given %s.",
        renderValue === null ? "null" : typeof renderValue,
      );
    } else if (render.length !== 0 && render.length !== 2) {
      console.error(
        "forwardRef render functions accept exactly two parameters: props and ref. %s",
        render.length === 1
          ? "Did you forget to use the ref parameter?"
          : "Any additional parameter will be undefined.",
      );
    }
    if (renderValue != null && (renderValue as { defaultProps?: unknown }).defaultProps != null) {
      console.error(
        "forwardRef render functions do not support defaultProps. " +
          "Did you accidentally pass a React component?",
      );
    }
  }
  const elementType: ForwardRefComponent = { $$typeof: REACT_FORWARD_REF_TYPE, render };
  if (isDevelopment) {
    defineInheritedDisplayName(elementType, render);
  }
  return elementType;
}
