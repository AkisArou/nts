// WinUI 3 from TypeScript, as C# writes it: an unpackaged program whose
// `App` class extends XAML's `Application` and overrides `OnLaunched`.
//
// - `class App extends Application` is composed the way C#'s projection
//   composes it: the runtime makes an outer object answering the override
//   interface (`IApplicationOverrides`) and `IXamlMetadataProvider`, and
//   aggregates XAML's `Application` inside it. `new App()` in the
//   initialization callback `Application.Start` calls is that composition;
//   `this` in `OnLaunched` is the application, so `this.Exit()` and
//   `this.get_Resources()` are its own methods, and `super.OnLaunched(args)`
//   is `Application`'s own, past the override.
// - The metadata provider is WinUI's own, forwarded to: with it, and
//   `XamlControlsResources` merged into the application's resources, a
//   `Button` gets its template, so its laid-out width is not zero.
// - The first `Microsoft.*` activation bootstraps the Windows App SDK runtime
//   installed on the machine, through the bootstrapper built beside the
//   program.
// - The `setTimeout` is libuv's, and fires from inside XAML's loop: the host
//   posts its wake message to the thread's queue, which XAML dispatches like
//   any other. It reads the title back through the window and exits.
// - The button is a `PressButton`, a class over XAML's `Button` overriding
//   one method of `IControlOverrides`, as C# overrides one. The interface's
//   other 24 slots call `Button`'s own implementation, so when the timer
//   focuses the button, XAML's `OnGotFocus` reaches `Button`'s through one of
//   them, and `focused=true` says the focus moved.
// - It overrides `OnApplyTemplate` and `MeasureOverride` too, each calling
//   `super` as C# does. `templated=1` says XAML applied the template through
//   the override. Every layout pass measures through `MeasureOverride`,
//   whose `Size` crosses by value four times -- into the override, into
//   `Button`'s, back, and out through the slot's result pointer -- so
//   `measured` counts them and `styled=true` says each arrived whole. The
//   interface's other slots, `ArrangeOverride` among them, are `Button`'s.
// - Asked for its automation peer, XAML calls `PressButton`'s
//   `OnCreateAutomationPeer`, which answers a `PressPeer` -- a reference the
//   framework now owns -- and the peer's class name is `PressPeer`'s override
//   answering a string (`peer=PressPeer`).
// - `PressButton`'s constructor takes its label, as a C# control's would:
//   `super()` composes it, and the body sets its content with `this`.
// - Each class keeps its counters in fields, as C#'s do. The runtime holds
//   them beside the instance it composes (`nts_com_state`), and the timer
//   reads the button's from outside it.
// - The button's `click` listener (`addEventListener`) is a TypeScript
//   function counting into the application's `clicks` field. The timer presses
//   it the way an accessibility client does -- its automation peer's
//   `IInvokeProvider.Invoke` -- so no person is needed, and `clicks` shows the
//   listener ran once: added twice, it is added once, and a second listener,
//   removed, adds nothing.
// - `web`: a browser as the window's content -- WinUI's `WebView2`, its
//   `CoreWebView2` made and a page navigated to from a string -- answering
//   whether the navigation succeeded, heard as `navigationcompleted`. Its
//   types are `Microsoft.Web.WebView2.Core`'s, and it loads WebView2's two
//   DLLs from beside the program, which the build ships there; without
//   them `ensureCoreWebView2Async` rejects with 0x8007007E.
// - `after` is printed once `Start` returns, so the line shows the loop ended.
import type { ByValue } from "c:types";
import type { Size } from "winrt:Windows.Foundation";
import { Application, FocusState, Window } from "winrt:Microsoft.UI.Xaml";
import type { IFrameworkElementOverrides, ILaunchActivatedEventArgs } from "winrt:Microsoft.UI.Xaml";
import type { IPointerRoutedEventArgs } from "winrt:Microsoft.UI.Xaml.Input";
import { AutomationPeer, ButtonAutomationPeer, FrameworkElementAutomationPeer } from "winrt:Microsoft.UI.Xaml.Automation.Peers";
import { Button, Frame, Page, StackPanel, TextBlock, WebView2, XamlControlsResources } from "winrt:Microsoft.UI.Xaml.Controls";
import { ContentCoordinateConverter, ContentIsland } from "winrt:Microsoft.UI.Content";
import { ElementCompositionPreview } from "winrt:Microsoft.UI.Xaml.Hosting";
import { TypeKind } from "winrt:Windows.UI.Xaml.Interop";

// The overridable interface, as XAML reaches an override: bindings keep it
// off a class's queries, since it is a subclass's contract with its base, so
// the fixture declares the one query it uses to call the override the way
// the framework does.
declare module "winrt:Microsoft.UI.Xaml.Controls" {
  interface ButtonInterfaces {
    /**
     * @ntsQuery FFC6FD98-F38C-5904-9CE4-97A3427CF4BA
     */
    as_IFrameworkElementOverrides(this: Button): IFrameworkElementOverrides;
  }
}

// A peer of the program's own, as a C# control writes one: it overrides one
// of `IAutomationPeerOverrides`' methods and leaves the rest to
// `AutomationPeer`.
class PressPeer extends AutomationPeer {
  // `AutomationPeer`'s constructor is protected, as in C#: a peer is only
  // ever a subclass, which makes its own public.
  constructor() {
    super();
  }
  getClassNameCore(): string {
    return "PressPeer";
  }
}

class PressButton extends Button {
  entered = 0;
  templated = 0;
  measured = 0;
  states = "";
  peers = 0;
  label: string;

  constructor(label: string) {
    super();
    this.label = label;
    this.content = label;
  }

  onPointerEntered(_e: IPointerRoutedEventArgs | null): void {
    this.entered += 1;
  }
  onApplyTemplate(): void {
    super.onApplyTemplate();
    this.templated += 1;
  }
  goToElementStateCore(stateName: string, _useTransitions: boolean): boolean {
    this.states += stateName;
    return false;
  }
  onCreateAutomationPeer(): AutomationPeer {
    this.peers += 1;
    return new PressPeer();
  }
  measureOverride(available: ByValue<Size>): ByValue<Size> {
    this.measured += 1;
    return super.measureOverride(available);
  }
}

class App extends Application {
  launched = 0;
  clicks = 0;

  onLaunched(args: ILaunchActivatedEventArgs | null): void {
    super.onLaunched(args);
    this.launched += 1;
    this.resources.mergedDictionaries.Append(new XamlControlsResources().as_IResourceDictionary());
    const window = new Window();
    window.title = "nts";
    const button = new PressButton("Press");
    // Listeners as the DOM keeps them: one function added twice is added
    // once, and one removed hears nothing -- so a click counts 1, where
    // either going wrong counts 2 or 101.
    const counted = (): void => {
      this.clicks += 1;
    };
    button.addEventListener("click", counted);
    button.addEventListener("click", counted);
    const removed = (): void => {
      this.clicks += 100;
    };
    button.addEventListener("click", removed);
    button.removeEventListener("click", removed);
    window.content = button;
    window.activate();
    setTimeout(() => this.whenLaidOut(window, button), 200);
  }

  // Buttons made and dropped one after another, each given the same listener
  // and pressed. Under a counting provider each is freed when `pressOnce`
  // returns, and the next may be made where it was: its listener must still
  // be added, not taken for the entry the one before left. One a call,
  // rather than one an iteration: a handle made in a loop body is released
  // at its last use, and an automation peer holds its owner weakly, so the
  // button would end before its press.
  presses = 0;
  rebuilt(): number {
    const pressed = (): void => {
      this.presses += 1;
    };
    for (let made = 0; made < 20; made++) {
      pressOnce(pressed);
    }
    return this.presses;
  }

  // The checks wait for XAML to have templated, measured and arranged the
  // button, polling rather than sampling once: a desktop busy with another
  // program lays a window out later, and a single sample read that as a
  // failure.
  polls = 0;
  whenLaidOut(window: Window, button: PressButton): void {
    this.polls += 1;
    const laidOut = button.templated > 0 && button.measured > 0 && button.actualWidth > 0;
    if (!laidOut && this.polls < 75) {
      setTimeout(() => this.whenLaidOut(window, button), 200);
      return;
    }
    // Focus goes to the active window: made so again, since another
    // program may have taken the desktop's focus meanwhile.
    window.activate();
    const focused = button.focus(FocusState.Programmatic);
    button.as_IFrameworkElementOverrides().GoToElementStateCore("Custom", false);
    ButtonAutomationPeer.createInstanceWithOwner(button).as_IInvokeProvider().Invoke();
    const peer = FrameworkElementAutomationPeer.createPeerForElement(button).getClassName();
    const styled = button.actualWidth > 0;
    // The label read back as the string it was set as: `content` answers
    // any object, and a boxed string is unboxed into the string, as the
    // Windows Runtime's JavaScript projection read it.
    const shown = button.content;
    const content = typeof shown === "string" ? shown : "object";
    // The window's content is the button it was given, asked of the
    // object itself: `QueryInterface` for `Button`'s interface.
    const isButton = window.content instanceof Button;
    // A record written as its fields, where the call takes one by value.
    button.measure({ width: 1000, height: 1000 });
    const desired = button.desiredSize.width > 0;
    // Navigation by type, as C# writes `frame.Navigate(typeof(Page))`: the
    // `TypeName` a plain object copied into the struct, its name an HSTRING
    // made for the call, and the frame's page type copied back out.
    const frame = new Frame();
    const navigated = frame.navigate({ name: "Microsoft.UI.Xaml.Controls.Page", kind: TypeKind.Metadata }, null);
    const page = frame.sourcePageType;
    const current = frame.currentSourcePageType;
    const onPage = frame.content instanceof Page;
    // `navigate` is two interfaces' method, one argument fewer on the
    // other, declared as overloads: the checker's choice is the slot
    // called. A second navigation leaves the first on the back stack.
    frame.navigate({ name: "Microsoft.UI.Xaml.Controls.Page", kind: TypeKind.Metadata });
    const back = frame.backStackDepth;
    // A struct an `[out]` parameter writes, copied out into the field of
    // the call's value: the `Vector2` a property set was given, read back.
    const properties = ElementCompositionPreview.getElementVisual(button).compositor.createPropertySet();
    properties.insertVector2("v", { x: 1.5, y: -2 });
    const got = properties.tryGetVector2("v");
    const vector = String(got.returnValue) + ":" + String(got.value.x) + "," + String(got.value.y);
    // An array of objects the call allocated, each moved into an array of
    // the program's: the window's content island is among the thread's.
    const islands = ContentIsland.findAllForCurrentThread();
    const first = islands.length > 0 ? islands[0] : null;
    const island = first !== null && first.isConnected;
    // An array of objects where a call takes an array of one interface: a
    // literal is made of `IUIElement`s as it is written, and lent as it is;
    // an array the program holds of `Button`s is asked, element by element,
    // for `IUIElement` -- another pointer of each object's.
    const panel = new StackPanel();
    const caption = new TextBlock();
    caption.text = "caption";
    panel.children.ReplaceAll([new Button(), caption]);
    const lentAsItIs = panel.children.size;
    const buttons: Button[] = [new Button(), new Button(), new Button()];
    panel.children.ReplaceAll(buttons);
    const replaced = String(lentAsItIs) + ":" + String(panel.children.size);
    // Arrays of structs, both ways, as plain objects: two points copied into
    // a block of `Point`s for the call, and the `PointInt32`s it hands back
    // copied out -- their difference is the offset, whatever the window's
    // position; and the title bar's drag region set from a rectangle.
    const converter = ContentCoordinateConverter.createForWindowId(window.appWindow.id);
    const screen = converter.convertLocalToScreenWithPoints([{ x: 0, y: 0 }, { x: 10, y: 20 }]);
    window.appWindow.titleBar.setDragRectangles([{ x: 0, y: 0, width: 100, height: 32 }]);
    const points = String(screen.length) + ":" + String(screen[1].x - screen[0].x) + "," + String(screen[1].y - screen[0].y);
    const line =
      "title=" + window.title + " launched=" + String(this.launched) + " clicks=" + String(this.clicks) +
        " styled=" + String(styled) + " focused=" + String(focused) + " entered=" + String(button.entered) +
        " templated=" + String(button.templated) + " measured=" + String(button.measured > 0) + " states=" + button.states + " label=" + button.label + " content=" + content + " isButton=" + String(isButton) + " peer=" + peer + " peers=" + String(button.peers) + " desired=" + String(desired) + " navigated=" + String(navigated) + " page=" + page.name + ":" + String(page.kind) + " current=" + current.name + " onPage=" + String(onPage) + " back=" + String(back) + " vector=" + vector + " islands=" + String(island) + " replaced=" + replaced + " points=" + points + " rebuilt=" + String(this.rebuilt());
    this.browse(window, line);
  }

  // A browser, `WebView2`, as the window's content: its `CoreWebView2`
  // made (`ensureCoreWebView2Async`, an action awaited), a page navigated
  // to from a string, and the navigation's completion heard as an event of
  // `Microsoft.Web.WebView2.Core` -- whose metadata ships beside WinUI's.
  async browse(window: Window, line: string): Promise<void> {
    const web = new WebView2();
    window.content = web;
    await web.ensureCoreWebView2Async();
    const core = web.coreWebView2;
    const succeeded = await new Promise<boolean>((resolve) => {
      core.addEventListener("navigationcompleted", (_sender, args) => resolve(args.isSuccess));
      core.navigateToString("<p>nts</p>");
    });
    console.log(line + " web=" + String(succeeded));
    this.exit();
  }
}

function pressOnce(listener: () => void): void {
  const button = new Button();
  button.addEventListener("click", listener);
  ButtonAutomationPeer.createInstanceWithOwner(button).as_IInvokeProvider().Invoke();
}

Application.start(() => {
  new App();
});
console.log("after");
