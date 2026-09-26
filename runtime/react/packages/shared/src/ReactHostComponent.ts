// A host component, as a renderer declares it for JSX: `<Button label="Add" />`
// is checked against `Props`, and the React stage lowers the tag to its
// `Type` as a string -- `jsx("GtkButton", props)` -- which is how React
// knows a host element. So it costs no component of its own: no fiber, no
// call. It has no value at run time; a renderer declares it and never
// defines it (react-gtk/DESIGN.md, "Typing").

import type { ReactElement } from "shared/ReactTypes.ts";

export interface HostComponent<Type extends string, Props> {
  (props: Props): ReactElement;
  /** The host type the tag lowers to. */
  readonly hostType: Type;
}
