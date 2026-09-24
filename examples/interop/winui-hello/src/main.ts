// WinUI 3 from TypeScript: an unpackaged program, a window, and the program's
// own event loop running inside XAML's.
//
// - `Application.Start` takes a TypeScript function as its initialization
//   callback (a delegate), and runs XAML's message loop until `Exit`.
// - `Application.CreateInstance()` and `Window.CreateInstance()` construct
//   composable classes as themselves: no outer object, and the inner one given
//   back. The first `Microsoft.*` activation bootstraps the Windows App SDK
//   runtime installed on the machine, through the bootstrapper built beside
//   the program.
// - The `setTimeout` is libuv's, and fires from inside XAML's loop: the host
//   posts its wake message to the thread's queue, which XAML dispatches like
//   any other. It reads the title back through the window and exits.
// - A `Button` whose content is a boxed string, as its window's content, and
//   whose `Click` handler is a TypeScript function counting into a captured
//   `let`. The timer presses it the way an accessibility client does -- its
//   automation peer's `IInvokeProvider.Invoke` -- so no person is needed, and
//   `clicks` shows the handler ran once. Each interface the button is asked
//   as (`as_IButtonBase`, `as_IUIElement`) belongs to a class it derives from.
// - `after` is printed once `Start` returns, so the line shows the loop ended.
import { report } from "c:report";
import { PropertyValue } from "winrt:Windows.Foundation";
import { Application, Window } from "winrt:Microsoft.UI.Xaml";
import { ButtonAutomationPeer } from "winrt:Microsoft.UI.Xaml.Automation.Peers";
import { Button } from "winrt:Microsoft.UI.Xaml.Controls";

function main(): void {
  let launched = 0;
  Application.Start(() => {
    const app = Application.CreateInstance();
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
    launched += 1;
    setTimeout(() => {
      ButtonAutomationPeer.CreateInstanceWithOwner(button).as_IInvokeProvider().Invoke();
      report("title=" + window.get_Title() + " launched=" + String(launched) + " clicks=" + String(clicks));
      app.Exit();
    }, 200);
  });
  report("after");
}

main();
