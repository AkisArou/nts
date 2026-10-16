# Platform widget inventories — what the portable kit leverages, and what it leaves to projections

Companion to components.md. **Leveraged** = a portable component maps
onto it (see the matrix). **Projection-only** = fully usable today
through the generated bindings (react-gtk and its future siblings),
not claimed by the portable kit.

## Completeness status — read this first

This is a **semantic inventory, not an exhaustive class roster for any
platform**. "Every UI component" has no single denominator: vendors
count concrete widget/control classes, abstract bases, cells/items,
layout helpers, design-system patterns, styles/modifiers, and (in
SwiftUI/Compose) an open-ended universe of composable views
differently. The current status is:

| Surface | What is exact here | What is not claimed |
|---|---|---|
| GTK 4.24.1 / Adwaita 1.10.0 | The generated react-gtk host components: 73 GTK + 54 Adwaita tags | Every widget class in GIR. The installed matching GIR resolves to 105 Gtk and 62 Adw `GtkWidget` descendants, including abstract/base/internal and deprecated classes; react-gtk generates the widgets an app can construct as host nodes and records skipped props/signals in `widgets.skipped.txt` |
| UIKit / AppKit | A curated family-level control catalog | Every `UIView`/`NSView`/`NSControl` subclass, cell, controller, gesture, and helper type |
| SwiftUI | The important built-in concepts that differ from UIKit/AppKit | An enumerable component list — any `View`-conforming type is a component, and modifiers/styles multiply presentations |
| WinUI 3 | Microsoft's design-control families | Every type in `Microsoft.UI.Xaml.Controls`, primitives, panels, and helper classes |
| Android | Classic View + Material Components families | Every `android.widget`/AndroidX class and the separate Jetpack Compose composable catalog |

The exhaustive class-by-class inventories must be generated from each
platform's projection metadata at a pinned version, the same way the
GTK list can be. Until those generators exist, use this file to reason
about concepts and gaps, not to prove that a platform lacks something.

## GTK 4 (73, from react-gtk)

Leveraged: Box, Button, Calendar (in DateField popover), CheckButton,
DropDown, Entry, Grid, Image, Label, ListView, MenuButton, Picture,
Popover, PopoverMenu, ProgressBar, Scale, ScrolledWindow, SearchEntry,
Separator (inside Menu), SpinButton, Spinner, Stack/StackSwitcher,
Switch, TextView, ToggleButton, Video, Window (host root).

Projection-only: AboutDialog, ActionBar, ApplicationWindow (root
concept, not a component), AspectFrame, CenterBox, ColorDialogButton,
ColumnView (spreadsheet-grade tables are a deliberate non-goal for
the portable `List`), DragIcon, DrawingArea (custom rendering belongs
to apps via projections/canvas), EditableLabel, EmojiChooser,
Expander, Fixed (absolute positioning — anti-portable), FlowBox,
FontDialogButton, Frame, GLArea (graphics round), GraphicsOffload,
GridView (icon grids — candidate for a later `Grid` portable
component), HeaderBar (GNOME window chrome; window titlebar is host
territory), Inscription, LevelBar, LinkButton, ListBox (static lists;
portable `List` is data-driven), MediaControls (inside VideoView
implementations), Notebook (Tabs maps to switchers instead on
Adwaita), Overlay, Paned (split views — candidate later), PasswordEntry
(TextField `secure`), PopoverBin, PopoverMenuBar (shell menus),
Range (base class), Revealer (animation utility), ScaleButton,
Scrollbar (implicit in ScrolledWindow), SearchBar, StackSidebar,
SvgWidget, Text (internal), TreeExpander, Viewport, WindowControls,
WindowHandle.

## Adwaita (54, from react-gtk)

Leveraged: AlertDialog (Dialog), ViewSwitcher/ViewStack (Tabs),
Spinner (Progress indeterminate), Avatar (possible Image affordance).

Projection-only (GNOME-HIG-specific by design): AboutDialog,
ActionRow and the Row family (ComboRow, EntryRow, ExpanderRow,
PasswordEntryRow, SpinRow, SwitchRow, ButtonRow — the settings-list
idiom; a future portable `SettingsRow` could claim these), Banner,
Bin, BottomSheet (Dialog presentation variant decision), BreakpointBin,
ButtonContent, Carousel + indicators, Clamp/ClampScrollable, Dialog,
HeaderBar, InlineViewSwitcher, MultiLayoutView, the Navigation family
(NavigationPage/SplitView/View, OverlaySplitView, Sidebar — app
structure, later round), Preferences family, ShortcutLabel,
ShortcutsDialog, SplitButton, StatusPage, TabBar/TabButton/
TabOverview/TabView (document tabs — later desktop round), ToastOverlay
(toast/snackbar overlaps notifications; candidate `Toast`), ToggleGroup
(SegmentedControl candidate mapping), ToolbarView, ViewSwitcherBar/
Sidebar, Window, WindowTitle, WrapBox.

## UIKit (iOS, vendor catalog by family)

Leveraged: UILabel, UIButton, UITextField, UITextView, UISearchBar
(field), UISwitch, UISlider, UIStepper, UISegmentedControl,
UIProgressView, UIActivityIndicatorView, UIImageView, UIScrollView,
UICollectionView, UITableView (List variant), UIAlertController,
UIMenu, UIDatePicker, UIStackView.

Projection-only: UIToolbar, UINavigationBar, UITabBarController
(app structure), UIPageViewController, UISplitViewController,
UICollectionView compositional-layout specifics, UIControl
subclassing surface, UIRefreshControl (pull-to-refresh — candidate
List affordance), UIActivityViewController (covered by
navigator.share), UIImagePickerController (covered by photos.pick),
MKMapView (maps are parked), WKWebView (browser module's host),
UIVisualEffectView (blur — style effect), UIPasteControl (clipboard
UI phase), UIPageControl, UISwipeActionsConfiguration (list row
actions — candidate List extension).

## AppKit (macOS, vendor catalog by family)

Leveraged: NSButton (button/checkbox/radio), NSTextField,
NSSearchField, NSSwitch, NSSlider, NSStepper, NSSegmentedControl,
NSPopUpButton, NSProgressIndicator, NSImageView, NSScrollView,
NSTableView/NSCollectionView, NSAlert, NSMenu, NSDatePicker,
NSStackView.

Projection-only: NSOutlineView (trees), NSToolbar, NSSplitView
(candidate Paned equivalent), NSTabView (Tabs maps here on macOS
actually — move cell when implementing), NSColorWell/NSFontPanel
(system pickers — dialog providers), NSPathControl, NSLevelIndicator,
NSScrubber (Touch Bar era), NSRuleEditor/NSPredicateEditor (niche),
NSBrowser (column browser), NSOpenPanel/NSSavePanel (documents
module providers, not components), NSTokenField (candidate later),
NSStatusItem (shell tray).

## SwiftUI (Apple declarative layer — concepts, not widget classes)

SwiftUI is not a fourth Apple widget class library beside UIKit and
AppKit. Its built-ins are value-type `View`s plus styles and modifiers;
many presentations resolve to UIKit/AppKit underneath, while layout,
state-driven updates, and some drawing are SwiftUI's own. It therefore
cannot be inventoried as a finite class list in the same way.

Concepts SwiftUI makes first-class where UIKit has no exact one-to-one
public control: `Gauge`; `Table` (state-driven sortable columns);
`Grid` and lazy stacks/grids; `Form`, `Section`, `LabeledContent`,
and `GroupBox` as settings semantics; `DisclosureGroup` and
`OutlineGroup`; `AsyncImage`; `Canvas` and `TimelineView`;
state-driven `NavigationStack`/`NavigationSplitView` models;
`ShareLink`, `PhotosPicker`, `MultiDatePicker`, and
`sensoryFeedback`. Apple also supplies adjacent first-party SwiftUI
surfaces such as Swift Charts, which are separate frameworks.

Not genuinely SwiftUI-only: empty content (`ContentUnavailableView`
exists in both SwiftUI and UIKit), color picking (`UIColorWell` and
picker controllers), progress, lists, pickers, split views, and most
basic controls have UIKit/AppKit counterparts. UIKit/AppKit still go
deeper in collection/table configuration, text systems, drag and
drop, focus, pointer interactions, controllers, cells, and many
control-specific knobs; SwiftUI apps bridge to them when needed.

For our design, SwiftUI's most important idea is not any single extra
view. It is adaptive presentation: one state and semantic declaration,
with presentation selected by platform and size class — a split view
collapsing to a stack, tabs becoming a sidebar, a picker changing
presentation. See the adaptive-presentation section in components.md.

## WinUI 3 (Windows, vendor catalog by family)

Leveraged: Button, TextBox, RichEditBox, AutoSuggestBox, ToggleSwitch,
CheckBox, RadioButtons, Slider, NumberBox, ComboBox, ProgressBar/
ProgressRing, Image, ScrollViewer, ListView/GridView, ContentDialog,
MenuFlyout, TabView/Pivot, DatePicker/TimePicker, StackPanel/Grid,
TextBlock.

Projection-only: NavigationView (app structure — later round),
InfoBar (≈ Banner/Toast candidate), InfoBadge, Expander, TreeView,
DataGrid (community toolkit), CalendarView/CalendarDatePicker
(DateField candidates on this platform), ColorPicker, RatingControl,
PersonPicture (≈ Avatar), BreadcrumbBar, PipsPager, NumberBox
already counted, CommandBar/AppBarButton (window chrome), MapControl
(parked with maps), MediaPlayerElement internals beyond VideoView,
ScrollBar (implicit), ToolTip (a prop, not a component), Flyout
(Dialog/Menu substrate).

## Android (View + Material catalog by family)

Leveraged: TextView, MaterialButton, TextInputLayout/EditText,
SearchView, SwitchMaterial, MaterialCheckBox, RadioGroup, Slider,
Spinner/ExposedDropdownMenu, MaterialButtonToggleGroup, progress
indicators, ImageView, ScrollView/NestedScrollView, RecyclerView,
MaterialAlertDialog/BottomSheetDialog, PopupMenu, TabLayout,
DatePicker/TimePicker dialogs, LinearLayout/FrameLayout,
ConstraintLayout (layout implementation detail).

Projection-only: BottomNavigationView/NavigationRail/DrawerLayout
(app structure — later round), FloatingActionButton (a Button
affordance candidate), Chip/ChipGroup (candidate `Chip` component —
no clean iOS/GTK analogue, which is why it is not in v1), CardView
(style surface), Snackbar (≈ Toast candidate), SwipeRefreshLayout,
ViewPager2 (Tabs substrate), CalendarView, AnalogClock, RatingBar
(candidate), WebView (browser host), SurfaceView/TextureView
(Camera/Video substrates), ExpandableListView (legacy).

## What this inventory is for

When someone proposes a new portable component, they point at a
projection-only row that recurs across platforms (chips, rating,
trees, data grids, pull-to-refresh, toasts, split views, avatars)
and argue it generalizes. When someone asks "can your framework do
X on iOS?", the answer is in these lists, not in the portable kit's
size. Regenerate per-platform sections from generated bindings as
each host lands.
