// The `$$typeof` tags React uses to recognise its own objects. They are
// registered symbols so that two copies of React, or React and a library,
// agree on them.

export const REACT_LEGACY_ELEMENT_TYPE: symbol = Symbol.for("react.element");
export const REACT_ELEMENT_TYPE: symbol = Symbol.for("react.transitional.element");
export const REACT_PORTAL_TYPE: symbol = Symbol.for("react.portal");
export const REACT_FRAGMENT_TYPE: symbol = Symbol.for("react.fragment");
export const REACT_STRICT_MODE_TYPE: symbol = Symbol.for("react.strict_mode");
export const REACT_PROFILER_TYPE: symbol = Symbol.for("react.profiler");
export const REACT_CONSUMER_TYPE: symbol = Symbol.for("react.consumer");
export const REACT_CONTEXT_TYPE: symbol = Symbol.for("react.context");
export const REACT_FORWARD_REF_TYPE: symbol = Symbol.for("react.forward_ref");
export const REACT_SUSPENSE_TYPE: symbol = Symbol.for("react.suspense");
export const REACT_SUSPENSE_LIST_TYPE: symbol = Symbol.for("react.suspense_list");
export const REACT_MEMO_TYPE: symbol = Symbol.for("react.memo");
export const REACT_LAZY_TYPE: symbol = Symbol.for("react.lazy");
export const REACT_SCOPE_TYPE: symbol = Symbol.for("react.scope");
export const REACT_ACTIVITY_TYPE: symbol = Symbol.for("react.activity");
export const REACT_LEGACY_HIDDEN_TYPE: symbol = Symbol.for("react.legacy_hidden");
export const REACT_TRACING_MARKER_TYPE: symbol = Symbol.for("react.tracing_marker");
export const REACT_MEMO_CACHE_SENTINEL: symbol = Symbol.for("react.memo_cache_sentinel");
export const REACT_VIEW_TRANSITION_TYPE: symbol = Symbol.for("react.view_transition");
export const REACT_CLIENT_REFERENCE: symbol = Symbol.for("react.client.reference");

const FAUX_ITERATOR_SYMBOL = "@@iterator";

// The iterator method of an iterable child, or null. `@@iterator` is the
// pre-Symbol convention some older libraries still use.
export function getIteratorFn(maybeIterable: unknown): ((this: unknown) => Iterator<unknown>) | null {
  if (maybeIterable === null || typeof maybeIterable !== "object") {
    return null;
  }
  const record = maybeIterable as { [Symbol.iterator]?: unknown; [FAUX_ITERATOR_SYMBOL]?: unknown };
  const maybeIterator = record[Symbol.iterator] || record[FAUX_ITERATOR_SYMBOL];
  if (typeof maybeIterator === "function") {
    return maybeIterator as (this: unknown) => Iterator<unknown>;
  }
  return null;
}

export const ASYNC_ITERATOR: symbol = Symbol.asyncIterator;
