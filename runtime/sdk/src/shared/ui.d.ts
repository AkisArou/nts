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
 * - Declarative events carry typed values (onValueChange(v), onSubmit)
 *   or a normalized semantic Event (PressEvent); never raw DOM/native
 *   signal payloads. Underneath, host elements are EventTargets and
 *   use standard capture/bubble dispatch (see docs/ui/components.md).
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

/**
 * Every host element ref is a genuine W3C EventTarget. Portable hosts
 * dispatch their interactive events through the standard capture,
 * target, and bubble phases over these elements, so imperative
 * addEventListener/removeEventListener/dispatch work with web
 * semantics instead of a framework-private event registry. Host
 * packages narrow this type to their concrete native element type.
 */
export type NativeElement = EventTarget;

/**
 * The semantic activation event behind Pressable callbacks. It is a
 * real Event (bubbling and cancelable), normalized across pointer,
 * touch, keyboard, and assistive activation; raw platform payloads are
 * deliberately not exposed. stopPropagation() and preventDefault()
 * have their standard meanings for nested pressables and hosts.
 */
export interface PressEvent extends Event {
  readonly activation: "pointer" | "touch" | "keyboard" | "assistive";
}

/** A Yoga length: density-independent points, or a percentage of the owner. */
export type Length = number | `${number}%`;
/** A Yoga size/inset/margin value, including CSS `auto` where meaningful. */
export type DimensionValue = Length | "auto";
/** Yoga main's size keywords, shared by box sizes and grid tracks. */
export type SizeValue = DimensionValue | "max-content" | "fit-content" | "stretch";

export type GridTrackSizing = SizeValue | `${number}fr`;
/**
 * One CSS Grid track. The object form is Yoga's min/max sizing pair,
 * spelled `minmax(min, max)` in CSS. Flexible lengths use `fr`.
 */
export type GridTrackSize =
  | GridTrackSizing
  | { readonly min: GridTrackSizing; readonly max: GridTrackSizing };
/**
 * A Grid track list. The array form maps directly to Yoga's
 * GridTrackList. A string uses CSS track-list syntax limited to sizes,
 * fractions, minmax(), and repeat(); named lines are not supported by
 * Yoga and are not part of this contract.
 */
export type GridTrackList = string | readonly GridTrackSize[];
/** A Grid line exactly as Yoga models it: auto, an integer line, or a span. */
export type GridLineValue = number | "auto" | `span ${number}`;

type Alignment =
  | "flex-start"
  | "center"
  | "flex-end"
  | "stretch"
  | "baseline"
  | "start"
  | "end";
type Justification =
  | "auto"
  | "flex-start"
  | "center"
  | "flex-end"
  | "stretch"
  | "start"
  | "end"
  | "space-between"
  | "space-around"
  | "space-evenly";
type ContentDistribution =
  | Alignment
  | "space-between"
  | "space-around"
  | "space-evenly";

/**
 * Layout properties are cross-checked against Yoga upstream `main`
 * (the version this project will vendor), including its Grid surface
 * beyond the 3.2.1 stable baseline (docs/ui/yoga-style.md).
 * Every Yoga Style setter has a spelling below; edge-indexed C++ setters
 * become the familiar per-edge CSS property names. Paint properties
 * (background, border color/radius, opacity) are renderer concerns and
 * are never passed to Yoga. Portable layout defaults are Yoga's own
 * (column direction, shrink 0, relative position, border-box); every
 * host states them explicitly rather than inheriting browser defaults.
 */
export interface Style {
  // ---- Yoga layout: container and item behavior ----
  readonly direction?: "inherit" | "ltr" | "rtl";
  readonly display?: "flex" | "none" | "contents" | "grid";
  readonly boxSizing?: "border-box" | "content-box";
  readonly flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  readonly flexWrap?: "nowrap" | "wrap" | "wrap-reverse";
  readonly justifyContent?: Justification;
  readonly justifyItems?: Justification;
  readonly justifySelf?: Justification;
  readonly alignContent?: ContentDistribution;
  readonly alignItems?: Alignment;
  readonly alignSelf?: Alignment | "auto";
  readonly overflow?: "visible" | "hidden" | "scroll";
  readonly position?: "static" | "relative" | "absolute";
  /**
   * Portable shorthand, not Yoga's `setFlex`: a positive value means
   * flexGrow=value, flexShrink=1, flexBasis=0 (the React Native/web
   * reading). Use the explicit properties when that is not intended.
   */
  readonly flex?: number;
  readonly flexGrow?: number;
  readonly flexShrink?: number;
  readonly flexBasis?: SizeValue;
  readonly gap?: Length;
  readonly rowGap?: Length;
  readonly columnGap?: Length;

  // ---- Yoga layout: Grid (container and item placement) ----
  readonly gridTemplateColumns?: GridTrackList;
  readonly gridTemplateRows?: GridTrackList;
  readonly gridAutoColumns?: GridTrackList;
  readonly gridAutoRows?: GridTrackList;
  readonly gridColumnStart?: GridLineValue;
  readonly gridColumnEnd?: GridLineValue;
  readonly gridRowStart?: GridLineValue;
  readonly gridRowEnd?: GridLineValue;

  // ---- Yoga layout: sizes ----
  readonly width?: SizeValue;
  readonly height?: SizeValue;
  readonly minWidth?: SizeValue;
  readonly minHeight?: SizeValue;
  readonly maxWidth?: SizeValue;
  readonly maxHeight?: SizeValue;
  readonly aspectRatio?: number;

  // ---- Yoga layout: insets (absolute/relative positioning) ----
  readonly top?: DimensionValue;
  readonly right?: DimensionValue;
  readonly bottom?: DimensionValue;
  readonly left?: DimensionValue;
  readonly start?: DimensionValue;
  readonly end?: DimensionValue;

  // ---- Yoga layout: margin (auto allowed), padding, border widths ----
  readonly margin?: DimensionValue;
  readonly marginHorizontal?: DimensionValue;
  readonly marginVertical?: DimensionValue;
  readonly marginTop?: DimensionValue;
  readonly marginRight?: DimensionValue;
  readonly marginBottom?: DimensionValue;
  readonly marginLeft?: DimensionValue;
  readonly marginStart?: DimensionValue;
  readonly marginEnd?: DimensionValue;
  readonly padding?: Length;
  readonly paddingHorizontal?: Length;
  readonly paddingVertical?: Length;
  readonly paddingTop?: Length;
  readonly paddingRight?: Length;
  readonly paddingBottom?: Length;
  readonly paddingLeft?: Length;
  readonly paddingStart?: Length;
  readonly paddingEnd?: Length;
  readonly borderWidth?: number;
  readonly borderTopWidth?: number;
  readonly borderRightWidth?: number;
  readonly borderBottomWidth?: number;
  readonly borderLeftWidth?: number;
  readonly borderStartWidth?: number;
  readonly borderEndWidth?: number;

  // ---- Paint (renderer, not Yoga) ----
  readonly backgroundColor?: string;
  /**
   * A CSS image value as the host accepts it (for example a `url(...)`
   * reference or a gradient function). Keep binary/asset-typed images in
   * `Image`; this property is for decorative element backgrounds.
   */
  readonly backgroundImage?: string;
  readonly backgroundSize?:
    | "auto"
    | "cover"
    | "contain"
    | Length
    | readonly [Length | "auto", Length | "auto"];
  /** A CSS background-position value, e.g. "center", "left top", "25% 75%". */
  readonly backgroundPosition?: string;
  readonly backgroundRepeat?:
    | "repeat"
    | "repeat-x"
    | "repeat-y"
    | "no-repeat"
    | "space"
    | "round"
    | readonly ["repeat" | "no-repeat" | "space" | "round", "repeat" | "no-repeat" | "space" | "round"];
  readonly borderColor?: string;
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
  /** Escape hatch: the underlying host element, narrowed by each host package. */
  readonly ref?: (instance: NativeElement | null) => void;
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

export interface ListSection<Item> {
  /** Stable identity for the section; defaults to its index in `sections`. */
  readonly id?: string;
  readonly title?: string;
  readonly data: readonly Item[];
}

export interface ListRenderItemInfo<Item> {
  readonly item: Item;
  /** Index within its section, or within `data` for an unsectioned list. */
  readonly index: number;
  /** Index across all items, counting sections in order. */
  readonly globalIndex: number;
  /** Present when rendering a sectioned list. */
  readonly section?: ListSection<Item>;
  readonly sectionIndex?: number;
}

interface ListCommonProps<Item> extends CommonProps {
  readonly renderItem: (info: ListRenderItemInfo<Item>) => Node;
  /** Stable identity per item; defaults to its global index (with the usual warning). */
  readonly keyOf?: (item: Item, globalIndex: number) => string;
  readonly onItemPress?: (info: ListRenderItemInfo<Item>) => void;
  readonly ListEmpty?: Node;
  readonly ListHeader?: Node;
  readonly ListFooter?: Node;
  readonly ItemSeparator?: Node;
  /** Called as the end approaches (within `onEndReachedThreshold` items). */
  readonly onEndReached?: () => void;
  readonly onEndReachedThreshold?: number;
  /** Whether a reload triggered by the app or pull-to-refresh is in progress. */
  readonly refreshing?: boolean;
  /**
   * Enables the host's pull-to-refresh gesture where it has one. The host
   * calls this and does not complete the refresh itself: the app updates
   * its data and sets `refreshing` back to false.
   */
  readonly onRefresh?: () => void;
}

export interface SectionListProps<Item> extends ListCommonProps<Item> {
  readonly data?: never;
  readonly sections: readonly ListSection<Item>[];
  /** Defaults to `Text` with the section title. */
  readonly renderSectionHeader?: (info: {
    readonly section: ListSection<Item>;
    readonly sectionIndex: number;
  }) => Node;
  readonly renderSectionFooter?: (info: {
    readonly section: ListSection<Item>;
    readonly sectionIndex: number;
  }) => Node;
  /** Pin section headers while their section scrolls, where the host supports it. */
  readonly stickySectionHeaders?: boolean;
  readonly SectionSeparator?: Node;
}

export interface FlatListProps<Item> extends ListCommonProps<Item> {
  readonly data: readonly Item[];
  readonly sections?: never;
}

/**
 * Supply exactly one of `data` (flat) or `sections` (grouped).
 * Deferred on purpose (docs/ui/deferred.md): swipe actions, reorder,
 * edit mode, selection models, and row context actions.
 */
export type ListProps<Item> = FlatListProps<Item> | SectionListProps<Item>;

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

// ---- Interaction -----------------------------------------------------------------

export interface PressState {
  readonly pressed: boolean;
  readonly hovered: boolean;
  readonly focused: boolean;
}

/** Extra touch/pointer target area around a Pressable, in points. */
export type HitSlop =
  | number
  | {
      readonly top?: number;
      readonly right?: number;
      readonly bottom?: number;
      readonly left?: number;
    };

export interface PressableProps extends Omit<CommonProps, "style"> {
  readonly children?: Node | ((state: PressState) => Node);
  readonly style?: Style | ((state: PressState) => Style | undefined);
  readonly disabled?: boolean;
  /** The completed activation: release inside after press, Enter/Space when focused, or assistive activation. */
  readonly onPress?: (event: PressEvent) => void;
  readonly onLongPress?: (event: PressEvent) => void;
  /** Milliseconds before a sustained press becomes a long press. Default is host-native. */
  readonly delayLongPress?: number;
  readonly onPressIn?: (event: PressEvent) => void;
  readonly onPressOut?: (event: PressEvent) => void;
  readonly onHoverChange?: (hovered: boolean) => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
  readonly hitSlop?: HitSlop;
  /**
   * "native" uses the host's ordinary activation feedback for a pressable
   * surface (highlight, ripple, opacity or equivalent); "none" leaves all
   * feedback to state-driven children/style. Feedback is never the only
   * accessibility signal: a Pressable is exposed as a button by default.
   */
  readonly feedback?: "native" | "none";
}

/**
 * Makes arbitrary content one press target. Use `Button` when the native
 * button itself is the correct semantic; use Pressable for rows, cards,
 * images, and composite content. Disabled Pressables receive no press,
 * hover-to-activate, or focus activation callbacks.
 */
export declare const Pressable: Component<PressableProps>;

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
