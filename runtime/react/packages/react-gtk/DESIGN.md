# react-gtk: design draft

This is the plan for React's first real native host, for discussion before it
is built. It runs once the native runtime renders, which is waiting on
exceptions across calls in nts (see ../../README.md, Status).

## What an app writes

```tsx
import { useState } from "react";
import { ApplicationWindow, Box, Button, Label } from "react-gtk";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Box orientation="vertical" spacing={6}>
      <Label label={`Clicked ${count} times`} />
      <Button label="Add" onClicked={() => setCount((c) => c + 1)} />
    </Box>
  );
}
```

- Host components are GTK widgets, named without the `Gtk` prefix.
- **Props are the widget's GIR properties** in camel case (`has-frame` → `hasFrame`), typed as bind-gir types their setters (`label: string`, `spacing: number`, enums as their GIR enum).
- **Signals are `on` + the signal name in camel case**: `clicked` → `onClicked`, `notify::text` → `onNotifyText`. They are typed with the signal's own handler signature.
- Text children are the widget's `label`: `<Button>Add</Button>`.
- There is no cross-platform `<View>`. Hooks and logic are what apps share with the web.

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
| `appendChildToContainer` | the window's `set_child`, or the application's window list |
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
- `GtkListBox`: `append`, `remove`, and `insert` at the index of `before`'s row.

A widget with no child protocol refuses children at `appendInitialChild`,
with a message naming the widget.

**Lifetime.** A fiber's `stateNode` holds the widget. Cycles between fibers
and GObjects (a closure capturing a widget, connected to that widget) are the
case the GTK lane's `gtk-cycles` design already collects. `detachDeletedInstance`
disconnects the trampolines.

## Typing, the one open question

TypeScript must check `<Button label="x" onClicked={...} />` against
`ButtonProps`, and the reconciler must create a host fiber for it without an
extra component layer per widget. Upstream React recognises a host element by
a string `type`. Three ways to reconcile those:

1. **The lane's JSX pass lowers it.** `react-gtk` declares
   `Button(props: ButtonProps): ReactElement` for the checker. Our JSX pass
   (M3), which already knows `react-gtk`'s exports, emits
   `jsx("GtkButton", props)`. There is no runtime cost, but `Button` is only
   meaningful in JSX.
2. **A thin function component per widget** that returns
   `createElement("GtkButton", props)`. Plain TypeScript, and it works without
   the JSX pass, but it costs one extra fiber per widget: exactly the overhead a
   native renderer exists to avoid.
3. **A typed token.** `Button` is a string at run time, with a
   type-level-only props brand. The brand would be an intersection type, which
   nts has no layout for, so this is out unless nts erases brands.

The recommendation is option 1, with option 2 as a fallback where the pass
does not run. Types are generated from the same GIR data bind-gir reads: one
props type per widget class, with properties by inheritance
(`GtkWidget` → `GtkButton`) and signals with their handler signatures.

## Generated from GIR

`tools/gen-widgets.ts` writes `src/widgets.ts`: a node class for each widget
an app can construct (72 on GTK 4.22), and one function per GIR class that
sets its own props and hands other keys to its parent's, so Widget's props
are written once. It reads GIR for the structure and defaults and the
bindings `nts build` generated for what TypeScript can call, so a prop exists
only if its setter does. A widget's child protocol is found from its methods:
`append`/`remove`/`insert_child_after`/`reorder_child_after` is a box, a
`set_child` taking a widget holds one child. `src/widgets.skipped.txt` lists
what is left out and why. The main gaps are signals with arguments, object-
valued props, and construct-only props.

Regenerate after a GTK update, from a native program's generated bindings:
`node tools/gen-widgets.ts ../../native/gtk/types/gir`.

## Order of work

1. The GLib scheduler host and a minimal host config (`Window`, `Box`,
   `Label`, `Button`), rendering the counter above under `xvfb-run`, as the
   GTK lane runs its tests. The host config is done and verified on real
   widgets (`native/gtk`); rendering waits on the reconciler emitting
   natively.
2. Props and signals generated from GIR for every widget class. Done for
   props with scalar values and signals without arguments.
3. `ListBox`, `Entry` with controlled `text`, and the rest of the common
   widgets.
4. A benchmark against GJS on the same app, which the GTK lane's goal already
   names.
