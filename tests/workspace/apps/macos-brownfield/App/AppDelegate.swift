import AppKit
import AcmeSdk

@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    let sdk = Sdk()

    func applicationDidFinishLaunching(_ note: Notification) {
        sdk.remember(key: "opened", value: "1")
        sdk.notify(id: "welcome", title: "Acme", body: "Thanks for installing.")
    }
}
