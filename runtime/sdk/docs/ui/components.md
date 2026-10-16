# Portable UI components — concept matrix

The portable kit (`@nts/sdk/ui`, types in `src/shared/ui.d.ts`) beside
the platform projections. Each portable component is an ordinary
TypeScript component implemented per React host (react-gtk today,
React DOM for web/Chromium, future hosts for UIKit/AppKit/WinUI/
Android), rendering the real native control in the mapping below.
Anything not claimed here stays fully available through the
projections in the same tree — see platform-inventory.md.

Naming follows React Native (`View`, `Text`, `onPress`) because that
is the vocabulary portable-app developers arrive with, and because
native toolkits share its central rule: bare text exists only inside
a text component. Events pass typed values (`onValueChange(v: string)`),
never DOM or native event objects. Styling is the documented `style`
subset in ui.d.ts, with semantic theme tokens from `appearance`.

| Ours (`@nts/sdk/ui`) | GTK 4 / Adwaita (react-gtk, real) | UIKit (iOS) | AppKit (macOS) | WinUI 3 (Windows) | Android (View/Material) | DOM (web/Chromium) |
|---|---|---|---|---|---|---|
| `View` | Box / Grid (by layout) | UIView + UIStackView | NSView + NSStackView | StackPanel / Grid | LinearLayout / FrameLayout | `div` |
| `Text` | Label (+ Inscription for ellipsized) | UILabel | NSTextField (label) | TextBlock | TextView | `span`/`p` (by variant) |
| `ScrollView` | ScrolledWindow | UIScrollView | NSScrollView | ScrollViewer | ScrollView / NestedScrollView | `div` (overflow) |
| `List` (data-driven; sections + pull-to-refresh) | ListView + GListModel | UICollectionView | NSTableView / NSCollectionView | ListView | RecyclerView | virtualized `div` list |
| `Pressable` | widget with click/key controllers (or flat Button where semantically appropriate) | control/gesture surface with button accessibility | tracking-area/button-backed view | pointer/key events on a framework element | clickable View | `button` or element with button role |
| `Image` | Picture / Image | UIImageView | NSImageView | Image | ImageView | `img` |
| `Icon` (asset-based) | Image (icon name via themed icons where matching) | UIImageView (SF Symbol where matching) | NSImageView | Image / FontIcon where matching | ImageView (vector drawable) | `img`/inline SVG |
| `Button` | Button (+ suggested-action/destructive classes) | UIButton | NSButton | Button | MaterialButton | `button` |
| `TextField` | Entry | UITextField | NSTextField | TextBox | TextInputEditText | `input` |
| `TextArea` | TextView in ScrolledWindow | UITextView | NSTextView | RichEditBox / TextBox multiline | multiline EditText | `textarea` |
| `SearchField` | SearchEntry | UISearchBar (field part) | NSSearchField | AutoSuggestBox | SearchView | `input[type=search]` |
| `Switch` | Switch | UISwitch | NSSwitch | ToggleSwitch | SwitchMaterial | `input[type=checkbox role=switch]` |
| `Checkbox` | CheckButton | (no native checkbox — button with checkmark image, as RN does) | NSButton (checkbox) | CheckBox | MaterialCheckBox | `input[type=checkbox]` |
| `RadioGroup` | CheckButton group | (segmented/list idiom; custom group) | NSButton radio group | RadioButtons | RadioGroup | `input[type=radio]` group |
| `Slider` | Scale | UISlider | NSSlider | Slider | Slider | `input[type=range]` |
| `Stepper` | SpinButton (buttons part) | UIStepper | NSStepper | NumberBox (spin) | (custom +/- buttons) | `input[type=number]` |
| `Select` | DropDown | UIButton menu / UIPickerView (presentation by host) | NSPopUpButton | ComboBox | Spinner / ExposedDropdownMenu | `select` |
| `SegmentedControl` | ToggleGroup / linked ToggleButtons | UISegmentedControl | NSSegmentedControl | (RadioButtons styled / Pivot) | MaterialButtonToggleGroup | radiogroup of buttons |
| `Progress` | ProgressBar / Spinner (indeterminate) | UIProgressView / UIActivityIndicatorView | NSProgressIndicator | ProgressBar / ProgressRing | ProgressIndicator | `progress` |
| `Dialog` | AdwAlertDialog / Dialog | UIAlertController / sheet presentation | NSAlert / sheet | ContentDialog | MaterialAlertDialog / BottomSheetDialog | `dialog` |
| `Menu` | PopoverMenu (+ menu bar via shell) | UIMenu | NSMenu | MenuFlyout | PopupMenu | popover listbox |
| `Tabs` | StackSwitcher / AdwViewSwitcher / TabView | UITabBar (app-level) or segmented + pager | NSTabView | TabView / Pivot | TabLayout + ViewPager2 | tablist |
| `DateField` | Calendar in Popover | UIDatePicker | NSDatePicker | DatePicker | DatePickerDialog | `input[type=date]` |
| `CameraView` (MediaStream) | Picture/Video sink from stream frames (provider) | AVCaptureVideoPreviewLayer host view | same as iOS | MediaPlayerElement / capture preview | PreviewView (CameraX) | `video` |
| `VideoView` (media player) | Video / MediaControls | AVPlayerViewController layer | AVPlayerView | MediaPlayerElement | PlayerView (Media3) | `video` |

## Event model: W3C EventTarget underneath

React Native 0.88 moving dispatch onto the W3C EventTarget model
confirms the contract we want here, and changes nothing about the
declarative surface: app code keeps using semantic props
(`onPress`, `onValueChange`) with typed values, exactly as React
Native kept its prop names and payloads.

What it pins down for hosts (the missing piece our types now state):

- Every element ref is a `NativeElement`, a genuine `EventTarget`.
  Hosts dispatch interactive events through capture, target, and
  bubble phases over the element tree; there is no second,
  framework-private event registry to reason about.
- `Pressable`'s callbacks receive a normalized `PressEvent` (a real,
  bubbling, cancelable `Event` with an `activation` source), so
  `stopPropagation()` between nested pressables and
  `preventDefault()` have standard meanings, without exposing raw
  platform payloads.
- If the same activation has both a declarative prop and an
  imperative ref listener, the declarative prop runs first — the
  same ordering React Native chose.
- Imperative listeners on refs are an escape hatch for integration,
  not the way portable code is written. Declarative capture-phase
  props (an `onPressCapture`) are deferred until a host round proves
  the need; imperative capture listeners already can express it.
- Direct, non-bubbling host notifications (layout, focus on some
  hosts) stay target-only, as on the web.

Layout styling has its own cross-check against the layout engine:
docs/ui/yoga-style.md. Deferred interaction behavior (list swipe
actions today) is recorded in docs/ui/deferred.md.

## Reading the matrix honestly

- A cell names the **real control the host implementation must use**.
  If a host draws its own lookalike instead, that is an implementation
  defect, not a design choice.
- Two cells are compositions, not single controls (iOS checkbox and
  radio): the platform genuinely lacks them, and the matrix says so
  instead of inventing names. That is the pattern for all such cases
- `Window` is deliberately not a portable component in v1: window
  creation belongs to the host root (`createRoot(window)` in
  react-gtk, `windows` in the API SDK on desktop). A declarative
  portable Window is a desktop-round question.
- Navigation (stacks, routers) is a library over `Tabs`/views, not
  primitives; presentational containers only in v1.

## What a portable-only app will still miss

The v1 kit has 25 declarations because it intentionally targets the
semantic core, not a one-to-one replacement for any native catalog.
Widget counts are not coverage: one portable `List` claims several
native classes, while dozens of native classes are variants or
implementation pieces. Even so, an app that refuses projections will
feel these absences quickly:

1. **App structure and chrome.** Toolbars/title bars, navigation
   stacks, sidebars and split views, drawers, bottom navigation and
   navigation rails. `Tabs` alone is not an application shell.
2. **Advanced collections.** Tables/data grids with columns and
   sorting, trees/outlines, icon grids, carousels/pagers, swipe
   actions, reorder/edit modes, and sophisticated selection models.
   `List` covers flat and sectioned one-dimensional collections,
   sticky headers, separators, end-reached loading, and pull-to-refresh.
3. **Transient surfaces.** Popovers, tooltips, toasts/snackbars and
   banners, action sheets, teaching tips. v1 has `Dialog` and `Menu`.
4. **Form and settings semantics.** Grouped forms and labeled rows,
   autocomplete/token/chip entry, color and rating inputs, date
   ranges, and rich-text editing. v1 has the individual basic fields.
5. **Content states and layout mechanics.** Empty/error states,
   avatars, badges, disclosure/expander, split panes, overlay layers,
   explicit grids, keyboard/safe-area insets, gestures, focus order,
   and drag and drop. Several are contracts around components rather
   than additional leaf widgets.

Those are not framework capability gaps: every one remains available
through a projection in the same React tree. They are the prioritized
backlog for portable v2 concepts — adaptive navigation/app shell,
form/section/row, grid, table, tree, disclosure, split view, popover,
toast/banner, and list interaction extensions — if real apps show
they generalize cleanly.

## Adaptive presentation (the SwiftUI lesson)

Where a concept has one state and one meaning but several correct
native presentations, the portable component should say *what it is*,
not force one platform's mechanics everywhere. This is SwiftUI's
central UI idea: a split navigation declaration can become columns on
a wide display and a stack on a narrow one; tabs can become a sidebar;
a picker can present as a menu, segmented control, wheel, or pop-up
without changing its value or event contract.

Adopt that selectively:

- Hosts choose the presentation from traits they already know:
  platform, available width/size class, input mode, and user settings.
- App-visible invariant: same state, option order, accessible names,
  and value events in every presentation.
- `presentation: "automatic"` is the default where adaptation is
  defined; explicit presentations remain available when mechanics are
  part of the product design.
- Adaptation never changes information architecture by itself. Tabs
  becoming a sidebar is presentation; tabs becoming a navigation
  stack is a different component (`AdaptiveNavigation`, still to be
  designed), not a magic prop on `Tabs`.

This favors semantic components such as a future `AdaptiveNavigation`
and `Table` (columns on wide displays, rows when narrow) over copying
each platform's separate widget names. It does not replace exact
projections when an app is designing for one platform's idiom.
