// The Windows half, against WinRT.
//
// **Pretend-supported, and the interesting one.** WinRT's type surface is
// `.winmd` -- ECMA-335 metadata, the same container family as a .NET assembly.
// That makes binding it *structurally the same problem as reading class files*:
// a metadata reader over a well-specified binary format, producing declarations.
// `compiler/jvm-emitter`'s reader is the shape that transfers, which is why this
// is a nearer target than it looks from "we only do C and Java".
//
// What does not transfer is the calling convention: WinRT is COM underneath, so
// a call goes through a vtable and an `HSTRING`, not a JNI-style bridge.
using Windows.UI.Notifications;

public sealed class Scheduler {
    private System.Action<string> tapHandler;

    public void Schedule(string id, string title, string body, double delayMillis) {
        var xml = ToastNotificationManager.GetTemplateContent(ToastTemplateType.ToastText02);
        var toast = new ScheduledToastNotification(xml, System.DateTimeOffset.Now.AddMilliseconds(delayMillis));
        ToastNotificationManager.CreateToastNotifier().AddToSchedule(toast);
    }

    public void Cancel(string id) { }

    public void SetTapHandler(System.Action<string> handler) { this.tapHandler = handler; }
}
