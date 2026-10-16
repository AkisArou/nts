/**
 * @nts/sdk/ui — portable components (types only; see docs/ui/components.md
 * for the per-platform mapping and docs/ui/platform-inventory.md for what
 * stays projection-only).
 *
 * These are ordinary components implemented per React host — rendering
 * react-gtk widgets on GTK, DOM elements on web/Chromium, and future
 * hosts' controls elsewhere — never new host components and never
 * self-drawn lookalikes. The matrix in docs/ui/components.md names the
 * real control each host must use.
 *
 * Rules of the kit:
 * - Text lives only inside `Text` (and text-taking controls), as in
 *   react-gtk and React Native; there are no bare text nodes.
 * - Events carry typed values: onPress, onValueChange(v), onSubmit.
 *   No DOM events, no native signal payloads.
 * - Components are controlled; `defaultValue` where uncontrolled makes sense.
 * - Accessibility uses the ARIA vocabulary, mapped per platform.
 * - `style` is the strict subset below. A host implements what it can
 *   honestly map; the support stance per property belongs in the same
 *   ledger discipline as the APIs when implementations arrive.
 */
import type { VideoPlayer } from "./media.d.ts";

/** A component as JSX sees it. Rendering is the host implementations' job. */
export type Component<P> = (props: P) => unknown;

/** Anything renderable as a child (elements; strings only where typed as text). */
export type Node = unknown;
export type TextChild = string | number | boolean | null | undefined;

export interface Style {
  // layout (flex)
  readonly flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  readonly flexWrap?: "nowrap" | "wrap";
  readonly justifyContent?: "flex-start" | "center" | "flex-end" | "space-between" | "space-around";
  readonly alignItems?: "stretch" | "flex-start" | "center" | "flex-end" | "baseline";
  readonly alignSelf?: Style["alignItems"] | "auto";
  readonly flex?: number;
  readonly gap?: number;
  // spacing and size (density-independent points)
  readonly padding?: number;
  readonly paddingHorizontal?: number;
  readonly paddingVertical?: number;
  readonly margin?: number;
  readonly marginHorizontal?: number;
  readonly marginVertical?: number;
  readonly width?: number | `${number}%`;
  readonly height?: number | `${number}%`;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly aspectRatio?: number;
  // visual
  readonly backgroundColor?: string;
  readonly borderColor?: string;
  readonly borderWidth?: number;
  readonly borderRadius?: number;
  readonly opacity?: number;
  // text (on Text and text-taking controls)
  readonly color?: string;
  readonly fontSize?: number;
  readonly fontWeight?: "normal" | "medium" | "semibold" | "bold" | number;
  readonly fontFamily?: string;
  readonly fontStyle?: "normal" | "italic";
  readonly textAlign?: "left" | "center" | "right" | "justify";
  readonly lineHeight?: number;
}

/** Semantic colors, sourced from `appearance`; components consume, never hard-code. */
export interface Theme {
  readonly colors: {
    readonly surface: string;
    readonly onSurface: string;
    readonly surfaceVariant: string;
    readonly accent: string;
    readonly onAccent: string;
    readonly danger: string;
    readonly border: string;
    readonly placeholder: string;
  };
}

export interface CommonProps {
  readonly style?: Style;
  readonly testID?: string;
  readonly "aria-label"?: string;
  readonly "aria-hidden"?: boolean;
  readonly role?: string;
  /** Escape hatch: the underlying host widget, typed by each host package. */
  readonly ref?: (instance: unknown) => void;
}

// ---- Layout and text ---------------------------------------------------------

export interface ViewProps extends CommonProps {
  readonly children?: Node;
}

export interface TextProps extends CommonProps {
  readonly children?: TextChild | readonly TextChild[] | Node;
  /** Semantic scale step; hosts map to their type ramps. */
  readonly variant?: "title" | "heading" | "body" | "caption" | "label";
  readonly numberOfLines?: number;
  readonly selectable?: boolean;
}

export interface ScrollViewProps extends CommonProps {
  readonly children?: Node;
  readonly horizontal?: boolean;
  readonly onScroll?: (offset: { readonly x: number; readonly y: number }) => void;
}

export interface ListProps<Item> extends CommonProps {
  readonly data: readonly Item[];
  readonly renderItem: (info: { readonly item: Item; readonly index: number }) => Node;
  /** Stable identity per item; defaults to index (with the usual warning). */
  readonly keyOf?: (item: Item, index: number) => string;
  readonly onItemPress?: (item: Item, index: number) => void;
  readonly ListEmpty?: Node;
  readonly ListHeader?: Node;
  readonly ListFooter?: Node;
  /** Called as the end approaches (within `onEndReachedThreshold` items). */
  readonly onEndReached?: () => void;
  readonly onEndReachedThreshold?: number;
}

export declare const View: Component<ViewProps>;
export declare const Text: Component<TextProps>;
export declare const ScrollView: Component<ScrollViewProps>;
export declare const List: <Item>(props: ListProps<Item>) => unknown;

// ---- Media -------------------------------------------------------------------

export type ImageSource = URL | string | File | Blob;

export interface ImageProps extends CommonProps {
  readonly source: ImageSource;
  readonly contentFit?: "cover" | "contain" | "fill" | "none";
  /** Required unless decorative, in which case pass `aria-hidden`. */
  readonly alt?: string;
}

export interface CameraViewProps extends CommonProps {
  /** From navigator.mediaDevices.getUserMedia — a real MediaStream. */
  readonly stream: MediaStream;
  readonly mirrored?: boolean;
}

export interface VideoViewProps extends CommonProps {
  readonly player: VideoPlayer;
  readonly controls?: boolean;
  readonly contentFit?: "cover" | "contain" | "fill";
}

export interface IconProps extends CommonProps {
  readonly source: ImageSource;
  /** Square size in density-independent points. */
  readonly size?: number;
}

export declare const Image: Component<ImageProps>;
export declare const Icon: Component<IconProps>;
export declare const CameraView: Component<CameraViewProps>;
export declare const VideoView: Component<VideoViewProps>;

// ---- Controls ------------------------------------------------------------------

export interface ButtonProps extends CommonProps {
  readonly children?: TextChild | readonly TextChild[] | Node;
  /** Native idiom per host: suggested-action, prominent, filled, etc. */
  readonly variant?: "primary" | "default" | "plain" | "destructive";
  readonly disabled?: boolean;
  /** Shows the host's busy affordance and blocks presses. */
  readonly loading?: boolean;
  readonly onPress?: () => void;
}

export interface TextFieldProps extends CommonProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
  /** Soft-keyboard and autofill semantics, mapped per host. */
  readonly inputType?: "text" | "email" | "password" | "number" | "decimal" | "phone" | "url" | "oneTimeCode";
  readonly secure?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly invalid?: boolean;
  /** Shown under the field; also the accessible error text. */
  readonly errorText?: string;
  readonly onSubmit?: () => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
}

export interface TextAreaProps extends Omit<TextFieldProps, "inputType" | "secure" | "onSubmit"> {
  readonly numberOfLines?: number;
}

export interface SearchFieldProps extends Omit<TextFieldProps, "inputType" | "secure"> {
  readonly onCancel?: () => void;
}

export interface SwitchProps extends CommonProps {
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly disabled?: boolean;
}

export interface CheckboxProps extends CommonProps {
  readonly value: boolean | "indeterminate";
  readonly onValueChange: (value: boolean) => void;
  readonly disabled?: boolean;
  readonly label?: string;
}

export interface RadioGroupProps<T extends string> extends CommonProps {
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  readonly options: readonly { readonly value: T; readonly label: string; readonly disabled?: boolean }[];
  readonly disabled?: boolean;
}

export interface SliderProps extends CommonProps {
  readonly value: number;
  readonly onValueChange: (value: number) => void;
  /** Fires once at the end of an interaction, for commit-expensive updates. */
  readonly onSlidingComplete?: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
}

export interface StepperProps extends CommonProps {
  readonly value: number;
  readonly onValueChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
}

export interface SelectProps<T extends string> extends CommonProps {
  readonly value: T | undefined;
  readonly onValueChange: (value: T) => void;
  readonly options: readonly { readonly value: T; readonly label: string; readonly disabled?: boolean }[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> extends CommonProps {
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  readonly segments: readonly { readonly value: T; readonly label: string }[];
  readonly disabled?: boolean;
}

export interface ProgressProps extends CommonProps {
  /** 0..1; omit for indeterminate. */
  readonly value?: number;
}

export interface DateFieldProps extends CommonProps {
  readonly value: Date | undefined;
  readonly onValueChange: (value: Date) => void;
  readonly mode?: "date" | "time" | "datetime";
  readonly min?: Date;
  readonly max?: Date;
  readonly disabled?: boolean;
}

export declare const Button: Component<ButtonProps>;
export declare const TextField: Component<TextFieldProps>;
export declare const TextArea: Component<TextAreaProps>;
export declare const SearchField: Component<SearchFieldProps>;
export declare const Switch: Component<SwitchProps>;
export declare const Checkbox: Component<CheckboxProps>;
export declare const RadioGroup: <T extends string>(props: RadioGroupProps<T>) => unknown;
export declare const Slider: Component<SliderProps>;
export declare const Stepper: Component<StepperProps>;
export declare const Select: <T extends string>(props: SelectProps<T>) => unknown;
export declare const SegmentedControl: <T extends string>(props: SegmentedControlProps<T>) => unknown;
export declare const Progress: Component<ProgressProps>;
export declare const DateField: Component<DateFieldProps>;

// ---- Surfaces --------------------------------------------------------------------

export interface DialogProps extends CommonProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly children?: Node;
  /** Modal sheet (mobile) / centered window (desktop) — host decides mechanics. */
  readonly presentation?: "modal" | "sheet";
}

export interface MenuItemUI {
  readonly id?: string;
  readonly label?: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly checked?: boolean;
}

export interface MenuProps extends CommonProps {
  /** The trigger element. */
  readonly children?: Node;
  readonly items: readonly (MenuItemUI | "separator")[];
  readonly onSelect: (id: string) => void;
}

export interface TabsProps<T extends string> extends CommonProps {
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  readonly tabs: readonly { readonly value: T; readonly label: string; readonly badge?: number }[];
  /** The selected tab's content, rendered by the app. */
  readonly children?: Node;
}

export declare const Dialog: Component<DialogProps>;
export declare const Menu: Component<MenuProps>;
export declare const Tabs: <T extends string>(props: TabsProps<T>) => unknown;
