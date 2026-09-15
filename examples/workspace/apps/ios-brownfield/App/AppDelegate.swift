import UIKit
// TypeScript, compiled through LLVM, imported as an ordinary Swift module.
import AcmeSdk

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    let sdk = Sdk()

    func application(_ app: UIApplication, didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        sdk.remember(key: "opened", value: "1")
        sdk.notify(id: "welcome", title: "Acme", body: "Thanks for installing.")
        return true
    }
}
