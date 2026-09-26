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
// - `after` is printed once `Start` returns, so the line shows the loop ended.
import type { ByValue } from "c:types";
import type { Size } from "winrt:Windows.Foundation";
import { Application, FocusState, Window } from "winrt:Microsoft.UI.Xaml";
import type { IFrameworkElementOverrides, ILaunchActivatedEventArgs } from "winrt:Microsoft.UI.Xaml";
import type { IPointerRoutedEventArgs } from "winrt:Microsoft.UI.Xaml.Input";
import { AutomationPeer, ButtonAutomationPeer, FrameworkElementAutomationPeer } from "winrt:Microsoft.UI.Xaml.Automation.Peers";
import { Button, XamlControlsResources } from "winrt:Microsoft.UI.Xaml.Controls";

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
    this.resources.mergedDictionaries.Append(XamlControlsResources.create().as_IResourceDictionary());
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
    // A record written as its fields, where the call takes one by value.
    button.measure({ Width: 1000, Height: 1000 });
    const desired = button.desiredSize.Width > 0;
    console.log(
      "title=" + window.title + " launched=" + String(this.launched) + " clicks=" + String(this.clicks) +
        " styled=" + String(styled) + " focused=" + String(focused) + " entered=" + String(button.entered) +
        " templated=" + String(button.templated) + " measured=" + String(button.measured > 0) + " states=" + button.states + " label=" + button.label + " peer=" + peer + " peers=" + String(button.peers) + " desired=" + String(desired) + " rebuilt=" + String(this.rebuilt()),
    );
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
