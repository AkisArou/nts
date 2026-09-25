// WinUI 3 from TypeScript, as C# writes it: an unpackaged program whose
// `App` class extends XAML's `Application` and overrides `OnLaunched`.
//
// - `class App extends Application` is composed the way C#'s projection
//   composes it: the runtime makes an outer object answering the override
//   interface (`IApplicationOverrides`) and `IXamlMetadataProvider`, and
//   aggregates XAML's `Application` inside it. `new App()` in the
//   initialization callback `Application.Start` calls is that composition;
//   `this` in `OnLaunched` is the application, so `this.Exit()` and
//   `this.get_Resources()` are its own methods.
// - The metadata provider is WinUI's own, forwarded to: with it, and
//   `XamlControlsResources` merged into the application's resources, a
//   `Button` gets its template, so its laid-out width is not zero.
// - The first `Microsoft.*` activation bootstraps the Windows App SDK runtime
//   installed on the machine, through the bootstrapper built beside the
//   program.
// - The `setTimeout` is libuv's, and fires from inside XAML's loop: the host
//   posts its wake message to the thread's queue, which XAML dispatches like
//   any other. It reads the title back through the window and exits.
// - The button's `Click` handler is a TypeScript function counting into a
//   captured `let`. The timer presses it the way an accessibility client does
//   -- its automation peer's `IInvokeProvider.Invoke` -- so no person is
//   needed, and `clicks` shows the handler ran once.
// - `after` is printed once `Start` returns, so the line shows the loop ended.
import { report } from "c:report";
import { PropertyValue } from "winrt:Windows.Foundation";
import { Application, Window } from "winrt:Microsoft.UI.Xaml";
import type { ILaunchActivatedEventArgs } from "winrt:Microsoft.UI.Xaml";
import { ButtonAutomationPeer } from "winrt:Microsoft.UI.Xaml.Automation.Peers";
import { Button, XamlControlsResources } from "winrt:Microsoft.UI.Xaml.Controls";

let launched = 0;

class App extends Application {
  OnLaunched(_args: ILaunchActivatedEventArgs | null): void {
    launched += 1;
    this.get_Resources().get_MergedDictionaries().Append(XamlControlsResources.create().as_IResourceDictionary());
    const window = Window.CreateInstance();
    window.put_Title("nts");
    const button = Button.CreateInstance();
    button.as_IContentControl().put_Content(PropertyValue.CreateString("Press"));
    let clicks = 0;
    button.as_IButtonBase().add_Click(() => {
      clicks += 1;
    });
    window.put_Content(button.as_IUIElement());
    window.Activate();
    setTimeout(() => {
      ButtonAutomationPeer.CreateInstanceWithOwner(button).as_IInvokeProvider().Invoke();
      const styled = button.as_IFrameworkElement().get_ActualWidth() > 0;
      report("title=" + window.get_Title() + " launched=" + String(launched) + " clicks=" + String(clicks) + " styled=" + String(styled));
      this.Exit();
    }, 1500);
  }
}

Application.Start(() => {
  new App();
});
report("after");
