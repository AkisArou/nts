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
