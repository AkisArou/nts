# react-gtk

React's first native host: GTK 4 widgets as React host components. What
follows is built and checked on real GTK widgets, under reference counting and
with GTK warnings fatal (`native/gtk/build.sh`), except where a section says
it is designed only. A compiled app does not render yet: that waits on the
reconciler compiling natively (see ../../README.md, Status).

## What an app writes

```tsx
import { useState } from "react";
import { GtkWindow, Orientation } from "c:Gtk-4.0";
import { Box, Button, Label, createRoot } from "react-gtk";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Box orientation={Orientation.VERTICAL} spacing={6}>
      <Label label={`Clicked ${count} times`} />
      <Button label="Add" onClicked={() => setCount((c) => c + 1)} />
    </Box>
  );
}

const window = new GtkWindow();
createRoot(window).render(<Counter />);
window.present();
```

- `createRoot(window)` is `react-dom/client`'s root on a GTK window
  (`src/client.ts`). It renders concurrently and installs the reconciler's
  sync flush for controlled props.
- Host components are GTK widgets, named without the `Gtk` prefix.
- **Props are the widget's GIR properties** in camel case (`has-frame` → `hasFrame`), typed as bind-gir types their setters (`label: string`, `spacing: number`, enums as their GIR enum).
- **Signals are `on` + the signal name in camel case**: `clicked` → `onClicked`, `notify::text` → `onNotifyText`. They are typed with the signal's own handler signature.
- Text children are the widget's `label`: `<Button>Add</Button>`.
- There is no cross-platform `<View>`. Hooks and logic are what apps share with the web.

A fuller app, each piece described in the sections below:

```tsx
import { useState } from "react";
import { GtkApplication, GtkStringList } from "c:Gtk-4.0";
import { ApplicationFlags } from "c:Gio-2.0";
import { ApplicationWindow, Button, DropDown, Entry, Grid, HeaderBar, Stack, Window,
         createApplicationRoot } from "react-gtk";

const KEY_Escape = 0xff1b;

function Journal({ entries }: { entries: GtkStringList }) {
  const [page, setPage] = useState("write");
  const [draft, setDraft] = useState("");
  const [about, setAbout] = useState(false);
  return (
    <ApplicationWindow title="Journal" defaultWidth={640} defaultHeight={480}>
      <ApplicationWindow.Titlebar>
        <HeaderBar>
          <HeaderBar.Start>
            <Button label="About" onClicked={() => setAbout(true)} />
          </HeaderBar.Start>
          <HeaderBar.End>
            <Button label={page === "write" ? "Read" : "Write"}
                    onClicked={() => setPage(page === "write" ? "read" : "write")} />
          </HeaderBar.End>
        </HeaderBar>
      </ApplicationWindow.Titlebar>
      <Stack visibleChildName={page} onNotifyVisibleChildName={(name) => setPage(name ?? "write")}>
        <Stack.Page name="write" title="Write">
          <Grid rowSpacing={6}>
            <Grid.Child column={0} row={0}>
              <Entry text={draft} onNotifyText={setDraft} onKeyPressed={(keyval) => {
                if (keyval !== KEY_Escape) return false;
                setDraft("");
                return true;
              }} />
            </Grid.Child>
            <Grid.Child column={0} row={1}>
              <Button label="Save" cssClasses={["suggested-action"]} onClicked={() => entries.append(draft)} />
            </Grid.Child>
          </Grid>
        </Stack.Page>
        <Stack.Page name="read" title="Read">
          <DropDown model={entries} />
        </Stack.Page>
      </Stack>
      {about && <Window title="About" onCloseRequest={() => {
        setAbout(false);
        return false;
      }} />}
    </ApplicationWindow>
  );
}

const app = new GtkApplication({ application_id: "org.example.Journal", flags: ApplicationFlags.DEFAULT_FLAGS });
app.connect("activate", () => {
  createApplicationRoot(app).render(<Journal entries={new GtkStringList()} />);
});
app.run(null);
```

- `createApplicationRoot(app)` renders the application's windows; `createRoot(window)` renders into one window.
- A widget's slot is an element named after it (`<ApplicationWindow.Titlebar>`, `<HeaderBar.TitleWidget>`), and a container that places children with parameters takes them through its elements (`<Stack.Page name title>`, `<Grid.Child column row>`, `<HeaderBar.Start>`).
- `text`, `visibleChildName` and the other props the user changes are controlled, as React DOM's `value` is: the widget shows what the props say.
- `onKeyPressed`, `onClickPressed`, `onPointerMotion` and `onScroll` are on every widget.
- A `<Window>` rendered anywhere opens as its own window over the one it is rendered in, and closes when it is no longer rendered.

## How it maps onto the reconciler

The renderer is a host config: `src/ReactFiberConfig.ts`, which the native
build binds for `react-reconciler/ReactFiberConfig.ts`. It is the same
contract the noop renderer and the test host implement.

| React | GTK |
| --- | --- |
| `createInstance(type, props)` | construct the widget class for `type`, setting its construct properties from props (`new GtkButton({ label })`), then connect its signal props |
| `createTextInstance` | refused: GTK has no bare text node; text is a `Label`'s `label` |
| `commitUpdate(old, new)` | for each changed property, its setter; for signals, see below |
| `appendChild` / `insertBefore` / `removeChild` | the parent's container protocol (below) |
| `appendChildToContainer` | the root's (`src/HostRoot.ts`): a window's `set_child`, or, for an application, the window joining it |
| `finalizeInitialChildren` / `commitMount` | a window is presented at commit (below) |
| `hideInstance` / `unhideInstance` | `set_visible(false)` / `set_visible(true)`, for Suspense and Activity |
| `scheduleMicrotask` | nts's microtask queue |
| the scheduler host (`SchedulerHost.ts`) | GLib: `g_get_monotonic_time` for `now`, `g_idle_add_full` to post work, `g_timeout_add_full` for timers |

**Signals are connected once.** A signal prop connects a trampoline the
first time it appears. The trampoline calls whatever handler the current
props hold, so a re-render with a new closure (the common case) changes one
field and never reconnects. A signal prop that goes away leaves the handler
null, so it can come back without reconnecting.

**A removed prop restores GTK's default**, from GIR's `default-value`, not
the last value set. Removals apply before sets, as in React DOM, because two
props can reach one setter (text children and `label`).
The trampoline sets the current update priority to `DiscreteEventPriority`
for the handler's duration, as React DOM's `dispatchDiscreteEvent` does, so
a click is a discrete update (`resolveUpdatePriority` in the host config
reads it back).

**Containers differ by widget, and the renderer knows each protocol.**
- `GtkBox`: `append`, `remove`, and for React's `insertBefore(child, before)`,
  `insert_child_after(child, before.get_prev_sibling())`, where a null
  sibling prepends.
- `GtkWindow`/`GtkApplicationWindow`: a single `set_child`.
- `GtkListBox` and `GtkFlowBox`: `append`, `remove`, and `insert` at an index.
  The node keeps its children in React's order, so the index is `before`'s
  place in it. A list wraps a child that is not a row in a row it makes, and
  what the list holds for each (the child or its row) is what moves or goes.
  A move takes the child back out of that row (`set_child(null)`) first.

A widget with no child protocol refuses children at `appendInitialChild`,
with a message naming the widget.

**A root is a window or an application.** `createRoot(window)` renders into
a window, which holds one child. `createApplicationRoot(app)` renders an
application's windows: each `<ApplicationWindow>` at its root joins the
application (`set_application`), is presented at commit, and leaves it when
it is no longer rendered. There are two entry points rather than one taking
either, because a union of two handle types has no native representation.

**A window is a toplevel wherever it is rendered.** A component can render a
dialog (`<Window>`, `<AboutDialog>`) inside its tree, and the dialog opens
over the window that tree is in, not as a child, which GTK does not allow.
Placing a window records what opened it and nothing more, because React
places a new tree during render, which can be thrown away, and before that
tree is in any window. `finalizeInitialChildren` asks for a commit mount,
and `commitMount` presents the window, transient for the window its opener
is in. Taking it out destroys it, so unmounting a dialog closes it. A window
rendered at the root opens over the root's window the same way. A popover
is the third placement: rendered in a widget, it is attached to that widget
(`set_parent`), not placed among its children, and shown by its `visible`
prop; taken out, it is detached.

**Lifetime.** A fiber's `stateNode` holds the widget. Cycles between fibers
and GObjects (a closure capturing a widget, connected to that widget) are the
case the GTK lane's `gtk-cycles` design already collects. `detachDeletedInstance`
disconnects the trampolines.

## Typing

TypeScript must check `<Button label="x" onClicked={...} />` against
`ButtonProps`, and the reconciler must create a host fiber for it without an
extra component layer per widget. Upstream React recognises a host element by
a string `type`.

**Each widget is declared as a host component, and the React stage lowers
its tag.** `src/widgets.ts` declares, and never defines,

```ts
export declare const Button: HostComponent<"GtkButton", ButtonProps>;
```

(`shared/ReactHostComponent.ts`). A tag whose checker type is a
`HostComponent<"GtkButton", ...>` lowers to `jsx("GtkButton", props)`, so
the element is a host element, as a string type makes it in React DOM, and
costs no component. The stage asks the checker, so the mechanism belongs to
no one renderer: any host can declare its components this way. There is no
run-time value to reach by another route: `Button` used outside JSX has
nothing behind it, and a native build refuses it.

The two alternatives this replaced: a thin function component per widget
(one extra fiber per widget, which a native renderer exists to avoid), and a
string token with a type-level brand (an intersection type, which nts has no
layout for).

## Generated from GIR

`tools/gen-widgets.ts` writes `src/widgets.ts`: a node class for each widget
an app can construct (72 on GTK 4.22), and one function per GIR class that
sets its own props and hands other keys to its parent's, so Widget's props
are written once. It reads GIR for the structure and defaults and the
bindings `nts build` generated for what TypeScript can call, so a prop exists
only if its setter does. A widget's child protocol is found from its methods:
`append`/`remove`/`insert_child_after`/`reorder_child_after` is a box, a
`set_child` taking a widget holds one child. A signal's handler takes the
signal's arguments after the widget, typed as an app writes them
(`onRowActivated?: (row: GtkListBoxRow) => void`, a `double` as `number`),
read from the bindings' own `connect` overloads (154 signals on GTK 4.22, and 420 `notify` props).
A signal whose handlers answer whether they handled it (GTK's `gboolean`,
as `close-request` does) takes a handler that returns a `boolean`; with the
prop absent the answer is "not handled", so the widget's default runs.
Every prop with a getter also has `onNotify<Prop>`, called with the
property's new value when it changes (`onNotifyText={(text) => ...}`), what
a controlled prop needs to hear. A handler hears the user and not React:
nothing is dispatched while props are applied, so setting `text` or
`active` from props does not call `onNotifyText` or `onToggled`, as React
DOM does not call `onChange` for the value it sets.

**Input is a prop on every widget.** GTK 4 delivers keys, clicks, pointer
motion and scrolling through event controllers added to a widget, not
through the widget's signals. So every widget's props include
`onKeyPressed`/`onKeyReleased`, `onClickPressed`/`onClickReleased`,
`onPointerEnter`/`onPointerLeave`/`onPointerMotion` and `onScroll`
(`src/controllers.ts`). A widget gets a kind of controller on the first prop
that needs it, and the props of that kind share it. `onKeyPressed` and
`onScroll` answer whether they handled the event, as `close-request` does;
with the prop gone the answer is "not handled".

**Controlled props.** The props a user changes (an Editable's `text`, a
CheckButton's, ToggleButton's or Switch's `active`, a SpinButton's `value`,
an Expander's `expanded`, a DropDown's `selected`, a Stack's
`visibleChildName` (which a StackSwitcher changes), a Notebook's `page`, a
Paned's `position`, a MenuButton's `active`, a SearchBar's
`searchModeEnabled`) hold the widget when they
are given, as React DOM's `value` and `checked` do. When the user changes
one, its onNotify handler runs. Then, once GTK's own change is over (from
an idle source, since an Entry's edit notifies more than once), React's sync
work is flushed and the widget is put back to what the props say. An app
that took the new value into state has committed it by then, so it stays,
without passing through the old one. The flush is a hook the root installs
(`setAfterEvent(flushSyncWork)`), so the host does not import the
reconciler. The list is kept by hand in the generator: GIR does not say
which properties input changes.
`src/widgets.skipped.txt` lists what is left out and why. A prop can hold a
list of strings where GTK takes one (`cssClasses={["suggested-action",
"pill"]}`, an AboutDialog's `authors`), read back by `stringsOf`, which
checks each element, and cleared when the prop goes. A prop can hold an object
the app makes (an adjustment, a model, a list-item factory, a menu) when its
type is a class: it is read back from the props with `instanceof`, a check
against the object's GType, which is how a native build reads a GObject out
of an erased value. An interface has no value to check against, so an
interface-typed prop takes the classes the bindings declare that implement
it, topmost only: a ListView's `model` is a `GtkSingleSelection`, a
`GtkMultiSelection` or a `GtkNoSelection`, and a DropDown's is any of the
list models (`GListStore`, `GtkStringList`, the filter and sort models). The
prop is typed as that union, so an app's own implementation is refused where
it is written rather than dropped where it is read. Each class is checked in
turn and passed on narrowed to itself; one conditional over them all would
have a union of handle types, which a native build has no representation
for. An interface only private classes implement (`GFile`) stays out. A boxed
record the app makes (a ColorDialogButton's `rgba`, a Popover's `pointingTo`)
is read back the same way, since a boxed value records its GType too; a record
whose binding has no constructor (Pango's attribute lists and tab arrays,
made by `from_string`) is not something `instanceof` takes, and stays out. A widget-typed prop that
names another widget (`mnemonicWidget`, `defaultWidget`, `focusWidget`,
`keyCaptureWidget`, and a Stack's `visibleChild`, one of its own children)
takes a ref's `current`: a host element's public instance is its widget.

**Slot elements.** A widget-typed prop that *places* a child (a Paned's
start child, a window's titlebar, a Frame's label widget, a MenuButton's
popover) is not a prop: a widget has to be made by React to be placed, and
a prop's value is not rendered. It is a slot element, a member of its
widget's component:

```tsx
<Paned>
  <Paned.StartChild><Sidebar /></Paned.StartChild>
  <Paned.EndChild><Content /></Paned.EndChild>
</Paned>
```

`Paned.StartChild` is declared as a `HostComponent<"GtkPaned.StartChild", ...>`
on a `PanedSlots` interface the Paned component also is, so it lowers to a
host element like any widget, and its children are ordinary React children:
a component, a conditional, a keyed swap. Its node is a `SlotNode`, which
holds no widget: its one child fills the slot (`set_start_child`) once both
are placed, and empties it when either goes. A slot element names its
class, so `<Frame.LabelWidget>` inside an Expander is an error rather than
the Expander's label, and a subclass inherits its parent's slots
(`<ApplicationWindow.Titlebar>` is `GtkWindow.Titlebar`).

**Child elements.** A container that places a child with parameters of its
own takes it through an element that carries them:

```tsx
<Grid><Grid.Child column={1} row={0}><Label /></Grid.Child></Grid>
<Stack visibleChildName={page}><Stack.Page name="files" title="Files"><Files /></Stack.Page></Stack>
<Notebook><Notebook.Page tab="Files"><Files /></Notebook.Page></Notebook>
<Overlay><Picture /><Overlay.Layer><Spinner /></Overlay.Layer></Overlay>
<Fixed><Fixed.Child x={12} y={40}><Label /></Fixed.Child></Fixed>
```

A slot element and a child element are the same kind of node, a
`PlacedNode`: it holds one widget and attaches it to the widget it is in by
a protocol of its own, once both are placed, and detaches it when either
goes. A slot element fills a property; `<Grid.Child>` attaches at its cell
and moves when its cell changes; `<Stack.Page>` adds a named, titled page
and updates it in place; `<Notebook.Page>` inserts a page before the next
one React knows of; `<Overlay.Layer>` draws over the Overlay's main child,
which the Overlay holds as its one ordinary child; `<Fixed.Child>` puts its
child at a position and moves it there. GIR describes none of this, so these are written by
hand (`src/children.ts`) and the generator only declares them as members
and creates them. A widget placed in such a container directly is an error
that names the element to use. A container's prop that selects a child
(a Stack's `visibleChildName`, a Notebook's `page`) is applied before the
container has children, since React sets a node's props before placing
its children. So the page it names selects itself when it is attached. A
Stack keeps its pages in the order they were added: GtkStack cannot move
one, so a page React moves goes last.

A HeaderBar's or ActionBar's start and end are groups, which hold any
number of widgets:

```tsx
<HeaderBar>
  <HeaderBar.Start><Button label="Open" /><Button label="New" /></HeaderBar.Start>
  <HeaderBar.TitleWidget><Label label="Files" /></HeaderBar.TitleWidget>
  <HeaderBar.End><MenuButton /></HeaderBar.End>
</HeaderBar>
```

Both groups read left to right in React's order, so an end, which GTK packs
from the edge in, packs its children last first. Neither bar can move a
packed child, so any change packs the group again (`PackNode`): a bar
holds a handful.

The two kinds of node are placed by double dispatch: a parent asks its child
to place itself (`child.placeIn(parent, before)`), so a widget goes among
the children by the parent's protocol and a slot element fills its slot,
with no test of which kind a child is. Only single-child widgets have slots,
which the generator checks, so a slot element's place among the children
never has to be found.

The other gaps are construct-only props, and signal arguments of types a
JSX handler cannot name yet.

Regenerate after a GTK update, from a native program's generated bindings:
`node tools/gen-widgets.ts ../../native/gtk/types/gir`. Each driver's
`build.sh` fails when the generated file is stale for the bindings its build
just wrote.

## libadwaita: react-gtk/adw

libadwaita's widgets are a module of their own, `react-gtk/adw`, generated
from Adw-1.gir by the same generator (`--namespace Adw-1`, into `src/adw/`).
An Adw widget's props extend the GTK class it derives from
(`ApplicationWindowProps extends Gtk.ApplicationWindowProps`), and setting
one falls through to GTK's function for that class, so an Adw widget takes
every prop, signal, slot and input prop its GTK ancestors do. A property an
Adw class redeclares with a wider type (AdwPreferencesPage's `name`) keeps
its ancestor's type in the props, so the interfaces still extend.

```tsx
import { ApplicationWindow, HeaderBar, ToolbarView, adw } from "react-gtk/adw";

createApplicationRoot(app, { widgets: [adw] }).render(
  <ApplicationWindow title="Hello">
    <ApplicationWindow.Content>
      <ToolbarView>...</ToolbarView>
    </ApplicationWindow.Content>
  </ApplicationWindow>,
);
```

**A root creates only the widget sets it is given.** GTK's widgets always,
then each `WidgetSet` in its options' `widgets`. So an app that never imports
`react-gtk/adw` never links libadwaita, and a root's `createInstance` asks
its own sets. There is no registry every module adds itself to on import.
The JSX names are libadwaita's without the `Adw` prefix, as GTK's are
without `Gtk`: an app that uses both imports one set under other names. The
node classes carry the namespace (`AdwHeaderBarNode`, for the host type
`AdwHeaderBar`), so a program importing both modules' nodes needs no aliases.

**libadwaita's containers.**
- A container that only adds and removes (a PreferencesGroup's rows, a
  PreferencesPage's groups, an ExpanderRow's rows through `add_row`, a
  NavigationView's pages) keeps React's order itself: a child inserted before
  another takes out what follows and adds it again. A method that takes a
  particular class (a PreferencesPage takes groups) refuses any other child,
  naming what it holds.
- Containers with named places take group elements, as GTK's bars do:
  `<HeaderBar.Start>`, `<ToolbarView.Top>`/`<ToolbarView.Bottom>`,
  `<ActionRow.Prefix>`/`<ActionRow.Suffix>`, and an ExpanderRow's. They share
  core's `GroupNode`, with placements of their own (`src/adw/children.ts`), so
  core never names an Adw class. Which side of a row fills from its far edge
  was measured, not assumed: an ActionRow prepends its prefixes, and an
  ExpanderRow appends them.
- A ViewStack's pages are `<ViewStack.Page name title iconName badgeNumber>`,
  as GTK's Stack's are, and its `visibleChildName` is controlled and set only
  once the page it names exists.
- A dialog (`<AlertDialog>`, `<AboutDialog>`, `<PreferencesDialog>`) is
  presented, not placed: rendered in a widget, it is presented over that
  widget's window at commit (`present`), and closed when React takes it out
  (`force_close`), as a window opens over its opener. libadwaita presents it
  within its own windows (AdwApplicationWindow, AdwWindow), and as a window
  of its own over a plain GtkWindow.
- A container's subclasses take its elements (a SwitchRow is an ActionRow).
- libadwaita's rows take children only through their groups (GtkListBoxRow's
  `set_child` would replace the row's own layout), and its windows only
  through their `Content` slot.

**A container knows React's order of all its children**, slot and child
elements included. A widget inserted before a slot element goes before the
first widget after it, which is what let a PreferencesGroup keep its
`HeaderSuffix` slot beside its rows.

`native/adw` drives it as `native/gtk` drives GTK: an Adw prop and an
inherited GTK one, the ApplicationWindow's `Content` slot, a signal, an
EntryRow's controlled `text` (from GTK's Editable), an AdwApplication's
root, and a root without the set creating no Adw widget. It runs with the
desktop's settings shut out (an empty `XDG_CONFIG_HOME`, `GDK_DEBUG=no-portals`),
since libadwaita warns about a dark colour scheme it reads through the
settings portal.

## Lists: a row per item, rendered by React (designed, not built)

A ListView, GridView or ColumnView shows its model's items through a
factory. It makes a widget for each *visible* row and rebinds rows to other
items as the list scrolls. An app should write the row as React:

```tsx
<ListView model={selection} renderItem={(item: GtkStringObject) => <Label label={item.get_string()} />} />
```

**The design is a component that renders a portal per bound row.**
- `ListView` and `GridView` (and ColumnView's columns) become function
  components in `src/lists.tsx`, not host components.
- Each renders the host `GtkListView` with a `GtkSignalListItemFactory` it
  owns. The factory's `bind` and `unbind` record which item each list item
  shows, in a ref, and set state. GTK binds a frame's visible rows together,
  so they coalesce into one render.
- For each bound row it renders `createPortal(renderItem(item), row)`, keyed
  by the list item. GTK recycles list items, so a scroll that rebinds a row
  to another item updates that row's subtree rather than remounting it,
  which is the reuse GTK's recycling is for.

**A portal's container is where a row goes.** The host config's
`Container` is a `HostRoot` (`src/HostRoot.ts`), so a list item is a third
kind of root beside a window and an application, holding one child through
its own `set_child`. `appendChildToContainer` and its siblings already call
the root, so a portal into a row takes the root's code path.

**Why not the alternatives.**
- A root per row would not share context (a row could not read the app's
  theme or state) or batching, and every row would mount on bind. A portal
  keeps the row inside the tree that renders the list, as inline JSX would
  be.
- The host node cannot render the rows itself: the host config never calls
  a component. `renderItem` has to run inside React.

**What it waits for:** `useState` and `useRef`, and portals, compiled
natively (the `useState` chain in the census). Until then it could only be
checked in JavaScript, where react-gtk does not run.

## Order of work

1. The GLib scheduler host and a minimal host config (`Window`, `Box`,
   `Label`, `Button`), rendering the counter above under `xvfb-run`, as the
   GTK lane runs its tests. The host config is done and verified on real
   widgets (`native/gtk`); rendering waits on the reconciler emitting
   natively.
2. Props and signals generated from GIR for every widget class. Done for
   props with scalar values, and signals with scalar or widget arguments.
3. `ListBox` (done, with `FlowBox`), `Entry` with controlled `text` (done,
   with the other controlled props), and the rest of the common widgets.
4. Containers that place with parameters (Grid, Stack, Notebook, the bars'
   groups, Overlay, Fixed) and slot elements: done.
5. libadwaita as `react-gtk/adw` (above): generated, and driven on real widgets.
6. Lists rendered by React (above): designed, waiting on a native render.
7. A benchmark against GJS on the same app, which the GTK lane's goal already
   names.
