// A renderer's host components, declared for JSX and never defined: the
// stage lowers each tag to its host type (shared/ReactHostComponent.ts).
import type { JSX } from "react/jsx-runtime";

export interface HostComponent<Type extends string, Props> {
  (props: Props): JSX.Element;
  readonly hostType: Type;
}

export declare const Box: HostComponent<"GtkBox", { spacing?: number; children?: unknown }>;
export declare const Button: HostComponent<"GtkButton", { label?: string; onClicked?: () => void }>;
export declare const Label: HostComponent<"GtkLabel", { label?: string; children?: unknown }>;

// A widget with slot or child elements is also its elements' namespace, as
// react-gtk declares it: `<Paned.StartChild>` lowers to its own host type.
export interface PanedSlots {
  readonly StartChild: HostComponent<"GtkPaned.StartChild", { children?: unknown }>;
  readonly EndChild: HostComponent<"GtkPaned.EndChild", { children?: unknown }>;
}
export declare const Paned: HostComponent<"GtkPaned", { children?: unknown }> & PanedSlots;

export interface GridChildren {
  readonly Child: HostComponent<"GtkGrid.Child", { column?: number; row?: number; children?: unknown }>;
}
export declare const Grid: HostComponent<"GtkGrid", { children?: unknown }> & GridChildren;
