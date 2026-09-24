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
// - `after` is printed once `Start` returns, so the line shows the loop ended.
import { report } from "c:report";
import { Application, Window } from "winrt:Microsoft.UI.Xaml";

function main(): void {
  let launched = 0;
  Application.Start(() => {
    const app = Application.CreateInstance();
    const window = Window.CreateInstance();
    window.put_Title("nts");
    window.Activate();
    launched += 1;
    setTimeout(() => {
      report("title=" + window.get_Title() + " launched=" + String(launched));
      app.Exit();
    }, 200);
  });
  report("after");
}

main();
