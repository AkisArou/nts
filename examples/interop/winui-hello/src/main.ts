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
// - The button's `Click` handler is a TypeScript function counting into a
//   captured `let`. The timer presses it the way an accessibility client does
//   -- its automation peer's `IInvokeProvider.Invoke` -- so no person is
//   needed, and `clicks` shows the handler ran once.
// - `after` is printed once `Start` returns, so the line shows the loop ended.
import { report } from "c:report";
import type { ByValue } from "c:types";
import { PropertyValue } from "winrt:Windows.Foundation";
import type { Size } from "winrt:Windows.Foundation";
import { Application, FocusState, Window } from "winrt:Microsoft.UI.Xaml";
import type { IFrameworkElementOverrides, ILaunchActivatedEventArgs } from "winrt:Microsoft.UI.Xaml";
import type { IPointerRoutedEventArgs } from "winrt:Microsoft.UI.Xaml.Input";
import { ButtonAutomationPeer } from "winrt:Microsoft.UI.Xaml.Automation.Peers";
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

let launched = 0;
let entered = 0;

let templated = 0;
let measured = 0;
let states = "";

class PressButton extends Button {
  OnPointerEntered(_e: IPointerRoutedEventArgs | null): void {
    entered += 1;
  }
  OnApplyTemplate(): void {
    super.OnApplyTemplate();
    templated += 1;
  }
  GoToElementStateCore(stateName: string, _useTransitions: boolean): boolean {
    states += stateName;
    return false;
  }
  MeasureOverride(available: ByValue<Size>): ByValue<Size> {
    measured += 1;
    return super.MeasureOverride(available);
  }
}

class App extends Application {
  OnLaunched(args: ILaunchActivatedEventArgs | null): void {
    super.OnLaunched(args);
    launched += 1;
    this.get_Resources().get_MergedDictionaries().Append(XamlControlsResources.create().as_IResourceDictionary());
    const window = Window.CreateInstance();
    window.put_Title("nts");
    const button = new PressButton();
    button.as_IContentControl().put_Content(PropertyValue.CreateString("Press"));
    let clicks = 0;
    button.as_IButtonBase().add_Click(() => {
      clicks += 1;
    });
    window.put_Content(button.as_IUIElement());
    window.Activate();
    setTimeout(() => {
      const focused = button.as_IUIElement().Focus(FocusState.Programmatic);
      button.as_IFrameworkElementOverrides().GoToElementStateCore("Custom", false);
      ButtonAutomationPeer.CreateInstanceWithOwner(button).as_IInvokeProvider().Invoke();
      const styled = button.as_IFrameworkElement().get_ActualWidth() > 0;
      report("title=" + window.get_Title() + " launched=" + String(launched) + " clicks=" + String(clicks) + " styled=" + String(styled) + " focused=" + String(focused) + " entered=" + String(entered) + " templated=" + String(templated) + " measured=" + String(measured > 0) + " states=" + states);
      this.Exit();
    }, 1500);
  }
}

Application.Start(() => {
  new App();
});
report("after");
