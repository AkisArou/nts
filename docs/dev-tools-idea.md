There's a standard to unify on: the **Chrome DevTools Protocol (CDP)**. Put a CDP backend into nts's runtime, and the real Chrome DevTools becomes the front end for every target, with Console, Network, Elements, Memory and Profiler panels. Others have done this:

- **NativeScript** shows the native iOS and Android view tree in DevTools' Elements panel, with Network and Console working.
- **React Native** (via Hermes), **Node**, **Deno** and **Bun** all speak CDP.

### The design: one inspector in the runtime, per-platform adapters only where needed

In debug builds only, so release binaries pay nothing, the runtime serves CDP over a WebSocket on localhost. Devices are reached through `adb forward` or usbmux, and you connect from `chrome://inspect`.

| Panel                | CDP domain          | How nts provides it                                                                                                                                                      |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Console**          | Runtime, Log        | `console.*` sends structured messages. Expandable objects come from our own object layouts, so previews show real fields.                                                |
| **Network**          | Network             | Hooks in our `fetch`, `http`, `net` and WebSocket runtime modules: request events, timing, headers, response bodies.                                                     |
| **Elements**         | DOM, Overlay, CSS   | Each UI platform maps its native view tree to DOM nodes (below). Highlighting is drawn natively. Editing a value sets the native property.                               |
| **Memory**           | HeapProfiler        | Heap snapshots in Chrome's format, built from our reference-counted heap. We know every live object, its layout and its references, so retainer paths come out accurate. |
| **Performance**      | Profiler, Tracing   | A sampling profiler (stack sampling plus our symbol tables), with event-loop and timer events on the timeline.                                                           |
| **Application**      | Storage, DOMStorage | `localStorage` and IndexedDB, for the web-platform runtime.                                                                                                              |
| **Sources/Debugger** | Debugger            | The hard part; see below.                                                                                                                                                |

### Elements: a native-UI adapter per platform

- **GTK:** the widget tree, with properties as attributes. GTK has real CSS, so the Styles pane can show it.
- **Android:** the View hierarchy, through the runtime's JVM side.
- **iOS/macOS:** the UIView/NSView tree, done the way NativeScript does it.
- **Windows:** the WinUI visual tree.
- **Chromium target:** the real DOM, with the real DevTools.
- **React apps:** additionally the React DevTools component tree. Its backend can be embedded and connected to the standalone React DevTools, which the React lane can own.

### The hard part: breakpoints in ahead-of-time compiled code

Hermes and V8 can pause easily because they interpret or JIT the code. Native code has no interpreter to pause. Options:

1. **A CDP-to-lldb bridge.** The inspector forwards the Debugger domain to lldb (or JDWP on the JVM), using the DWARF and TypeScript source lines from the earlier answer. You get breakpoints and stepping in DevTools' Sources panel. It's the most unified option and the most work.
2. **Leave stepping to DAP** (VS Code, Xcode, Android Studio) and let CDP cover everything else.
3. **For logic bugs, run under node** with the full DevTools debugger, which only nts can offer.

I'd start with 2 plus 3, and build 1 later.

### Order of work

1. **Console** with rich object previews: big value, small effort.
2. **Network:** high value for app developers, all inside our own runtime modules.
3. **Memory and Profiler**, where our runtime's knowledge is unusually good.
4. **Elements**, one platform at a time, GTK first since its tree and CSS map most directly.
5. **The Debugger bridge.**

Every target, including the GTK, Android, iOS, Windows and node builds, opens the same Chrome DevTools, and the Chromium target already has it natively.
