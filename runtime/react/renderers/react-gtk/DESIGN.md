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
- **Props are the widget's GIR properties**, typed as bind-gir types them (`label: string`, `spacing: number`, enums as their GIR enum).
- **Signals are `on` + the signal name in camel case**: `clicked` → `onClicked`, `notify::text` → `onNotifyText`. They are typed with the signal's own handler signature.
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
field and never reconnects. A signal prop that goes away disconnects.
Handlers run inside `discreteUpdates`, so a click is a discrete event, as
in React DOM.

**Containers differ by widget, and the renderer knows each protocol.**
- `GtkBox`: `append`, `insert_child_after` (React's `insertBefore` is "after
  the previous sibling"), and `remove`.
- `GtkWindow`/`GtkApplicationWindow`: a single `set_child`.
- `GtkListBox`: `append`, `insert` at an index, and `remove`.

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

## Order of work

1. The GLib scheduler host and a minimal host config (`Window`, `Box`,
   `Label`, `Button`), rendering the counter above under `xvfb-run`, as the
   GTK lane runs its tests.
2. Props and signals generated from GIR for every widget class.
3. `ListBox`, `Entry` with controlled `text`, and the rest of the common
   widgets.
4. A benchmark against GJS on the same app, which the GTK lane's goal already
   names.
