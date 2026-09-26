# Writing a Mac app in TypeScript

nts compiles TypeScript to a native macOS executable or `.app`. The surface is
the one Swift gives an AppKit programmer. Apple's own importer supplies every
name, so the Swift documentation for a class is its documentation here too.
Everything below is exercised by an `examples/interop/macos-*` fixture, run on
a Mac against an Objective-C, C or Swift oracle, through both the C and the
LLVM backend. [`apple-lane-goal.md`](apple-lane-goal.md) is the lab notebook:
how each piece was built and measured, and what is refused.

## Setup

- **An SDK.** `tooling/apple/sync-sdk.sh` copies the macOS SDK from the Mac
  to `~/.cache/nts/apple/MacOSX.sdk`. The compiler never runs on the Mac, and
  builds on Linux against this copy.
- **Swift's names.** `tooling/apple/symbolgraph.sh AppKit Foundation
  CoreGraphics` runs `swift-symbolgraph-extract` on the Mac once per SDK. The
  binding generator reads those graphs.
- **A Mac to run on.** `tooling/apple/run.sh <artifact>` copies an executable
  or an `.app` there and runs it. `tooling/apple/vm.md` sets up the VM.

## Binding a framework

```sh
nts bind-objc --module objc:AppKit --framework AppKit --framework Foundation \
  --class NSWindow --class NSButton --class NSTableView \
  --protocol NSTableViewDataSource \
  --out types/appkit.d.ts --values types/appkit.values.ts
```

- Each `--class` is bound with its ancestors, and every member Swift imports.
  Whatever cannot be bound yet is listed in the class, with its reason.
- `--protocol` declares an interface that a class you write implements.
- `--values` writes the functions behind Swift's `async` forms.
- A Core Foundation class (`--class CGContext`) is bound as Swift imports it:
  its methods and properties are the C functions that take it.
- `--function` binds a free C function, such as
  `CGColorSpaceCreateDeviceRGB`. An `NSString *` it takes or returns is a
  `BridgedString`, which a plain `string` is passed as. Outside a message a
  `string` is a C string, and the brand says this one is Swift's `String`.
- `--witness out.c` writes a C program that asks the runtime on the Mac
  whether it implements every message the binding sends.

Commit the generated files, and regenerate them when the SDK changes. Each
fixture's `build.sh` regenerates its binding and diffs it against the
committed copy.

## The surface, from Swift

| Swift | TypeScript |
|---|---|
| `NSWindow(contentRect: r, styleMask: .titled, backing: .buffered, defer: false)` | `new NSWindow({ contentRect: r, styleMask: NSWindow.StyleMask.titled, backing: NSWindow.BackingStoreType.buffered, defer: false })` |
| `window.setFrame(r, display: true)` | `window.setFrame(r, { display: true })` |
| `view.addSubview(button)` | `view.addSubview(button)` |
| `window.title = "Notes"` | `window.title = "Notes"` (a `string`, copied into an `NSString`) |
| `NSApplication.shared` | `NSApplication.shared` |
| `window.contentView?.addSubview(b)` | `window.contentView?.addSubview(b)` |
| `window.contentView?.superview` (`NSView?`) | the same, `NSView \| null \| undefined`, one nil: test it with `== null` or `??` |
| `let views: [NSView]` | `const views: NSView[]` |
| `[String: NSObject]` | `Map<string, NSObject>` |
| `table.dataSource` (`(any UITableViewDataSource)?`) | `table.dataSource`, `UITableViewDataSource \| null`, when the binding declares the protocol (`--protocol`) |
| `UIView.animate(withDuration: 0.1, animations: { ... }, completion: nil)` | `UIView.animate({ withDuration: 0.1, animations: () => ... }, null)`: an optional closure is `(...) \| null` |
| `override func viewDidLoad() { super.viewDidLoad(); title = "Items" }` | `override viewDidLoad(): void { super.viewDidLoad(); this.title = "Items"; }` |
| `delegate?.tableView?(t, didSelectRowAt: p)` | `delegate?.tableViewDidSelectRowAt?.(t, p)`, which asks `respondsToSelector:` first |
| `Set<IndexPath>`, `Set<String>` | `Set<NSIndexPath>`, `Set<string>` (objects compared by `-isEqual:`) |
| `NSRect(x: 0, y: 0, width: 320, height: 200)` | `{ origin: { x: 0, y: 0 }, size: { width: 320, height: 200 } }` |
| `Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { t in ... }` | `Timer.scheduledTimer({ withTimeInterval: 1, repeats: true }, (t) => { ... })` |
| `try NSString(contentsOfFile: p, encoding: e)` | `new NSString({ contentsOfFile: p, encoding: e })`, which throws an `Error` |
| `let r = await window.beginSheet(sheet)` | `const r = await window.beginSheet(sheet)` |
| `NSWindow.StyleMask.titled \| ...` | `NSWindow.StyleMask.titled \| ...` (a `const enum`) |
| `CGColor(red: 1, green: 0, blue: 0, alpha: 1)` | `CGColor({ red: 1, green: 0, blue: 0, alpha: 1 })` |
| `context.fill(rect)` | `context.fill(rect)` |

The shape of an argument list follows one rule, Swift's own:

- **Unlabelled arguments** (`_`) are positional.
- **Labelled arguments** go in one trailing object. The compiler passes it
  field by field and never allocates it.
- **A closure last** is passed after that object, as Swift's trailing
  closure is.

A C record Swift passes by value (`NSRect`, `CGPoint`) is written as its
fields: a literal in the call, or an object held in a variable. Either way it
becomes storage in the caller's frame, as a C compound literal does. A record a
message returns is read as `rect.size.width`.

A number is a `number`: `CGFloat`, `Int`, `UInt` and the rest are brands that
accept any number and are converted at the call.

## Classes of your own

```ts
class Notes extends NSObject implements NSTableViewDataSource {
  items: string[] = [];

  constructor(private readonly path: string) {
    super();
  }

  numberOfRows(tableView: NSTableView): Int {
    return this.items.length;
  }

  add(sender: NSObject): void {
    this.items.push(`note ${this.items.length + 1}`);
  }
}
```

- The class is a real Objective-C class, registered when the program starts.
  Each method is an entry the runtime calls. Its selector comes from the
  protocol, or from the superclass method it overrides (`draw(_:)` is
  `drawRect:`), or from Swift's `@objc` rule (`add(sender)` is `add:`).
- Fields live in an object the instance holds. A subclass's fields follow its
  base's. Initializers run at `init`, and the fields are released at
  `dealloc`.
- `super.draw(dirtyRect)`, `super.alignmentRect(labels)` and `super(...)` in
  a constructor are messages to the superclass.
- `instanceof` asks `isKindOfClass:`, and narrows.
- A method whose arguments no Objective-C message could carry, such as
  `append(item: string)`, is Swift's method without `@objc`. The runtime is
  not told of it, and only the program calls it. A protocol's method, an
  override of a binding's method, or one tagged `@ntsSelector` must cross.
- A call the program writes reaches the compiled method directly. Where a
  subclass the program writes overrides it, the receiver's class is
  compared with each of the program's classes and the matching method is
  called, as a vtable would. A class the runtime made, such as key-value
  observing's, is asked `isKindOfClass:`.

A button's action is Swift's `#selector(Notes.add(_:))`:
`button.action = selector(Notes, "add")`, with `import { selector } from
"objc:runtime"`. The checker holds the name to a method of the class, and
the compiler answers the selector the runtime registered it under (`add:`).
A binding's class answers its method's own: `selector(NSWindow, "close")`.

## An application

An application delegate is a class like any other, and a menu item's action
is a selector, as a button's is:

```ts
class AppDelegate extends NSObject implements NSApplicationDelegate {
  constructor(private readonly started: () => void) {
    super();
  }

  applicationDidFinishLaunching(notification: NSNotification): void {
    this.started();
  }
}

const menu = new NSMenu({ title: "Notes" });
const item = new NSMenuItem({ title: "Add", action: selector(Notes, "add"), keyEquivalent: "n" });
item.target = notes;
menu.addItem(item);
app.mainMenu = menu;
app.delegate = new AppDelegate(() => { /* what the application does once launched */ });
app.run();
```

`examples/interop/macos-notes` is such an application, and
`reference/notes.swift` beside it is the same program in Swift. Its
output is compared with the TypeScript program's, line for line.

## Drawing

Bind the Core Graphics classes beside AppKit (`--framework CoreGraphics
--class CGContext --class CGColor`), and draw in an override:

```ts
draw(dirtyRect: ByValue<CGRect>): void {
  const context = NSGraphicsContext.current?.cgContext;
  if (context !== undefined) {
    context.setFillColor({ red: 1, green: 0, blue: 0, alpha: 1 });
    context.fill({ size: { width: 10, height: 10 } });
  }
}
```

A Core Foundation object is counted like any other: a function Swift imports
as an initializer hands over a reference, which the program releases once
nothing holds it. `examples/interop/macos-draw` draws into a bitmap and
compares every pixel with the same drawing in C.

## Memory

Build with reference counting (`nts build --rc`). An Objective-C object is
counted as ARC counts it: the program owns what `alloc`, `new`, `copy` and a
Core Foundation `Create` hand it, and retains what it keeps. A closure passed
as a block is carried to the thread that owns it when Cocoa calls it from
another. An awaited operation keeps the program alive until its completion
handler runs.

## Building an app

```ts
import { app, defineConfig, target } from "@nts/config";

export default defineConfig({
  products: {
    notes: app({
      kind: "application",
      id: "dev.example.notes",
      entry: "./src/main.ts",
      targets: [target.macos({ minimumVersion: "13.0", arch: "aarch64", backend: "llvm" })],
    }),
  },
});
```

`nts build` writes `notes.app`, whose `Info.plist` comes from the product's
`id` and `minimumVersion`. A `kind: "executable"` product is a bare binary.
Each target picks `x86_64` or `aarch64`, and the `c` or `llvm` backend.

## iOS

The same surface builds a UIKit application for the iOS simulator. The
target is `target.ios({ minimumVersion: "17.0", arch: "x86_64" })`, bound
with `nts bind-objc --sdk <iPhoneSimulator.sdk> --target
x86_64-apple-ios17.0-simulator --framework UIKit ...`. An `application`
product is an `.app` that `tooling/apple/run-ios.sh` installs and launches
with `simctl`. The program starts UIKit as Swift's `main.swift` does,
`UIApplicationMain(0, null, null, "AppDelegate")`: bound with `--function
UIApplicationMain`, the delegate class given by name, and `exit` from
`c:stdlib` to end it (see `examples/interop/ios-hello`, and
`examples/interop/ios-list` for a table view's data source). Each has a Swift
twin in `reference/`, whose output is compared with the TypeScript program's.
`examples/interop/ios-nav` is a navigation stack of view controllers the
program writes, driven by UIKit's lifecycle. A device build needs signing, and
is refused.

## Not yet

- **Out-parameters of objects.** `NSString **` and
  `AutoreleasingUnsafeMutablePointer` are skipped, with their reason.
- **Swift-only API.** Swift's overlay adds functions with no C or
  Objective-C symbol, such as `CGContext.move(to:)`. Those are not bound.
  `NSBezierPath` builds paths.
