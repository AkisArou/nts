// The Apple half, in Swift -- which is what this would really be.
//
// **Pretend-supported.** This compiler binds C headers and Java class files
// today; Swift is neither. The realistic route is the one Swift already
// provides for its own interop: `swiftc -emit-objc-header` produces a C/ObjC
// header for anything `@objc`, and `.swiftinterface` carries the full module
// surface. So binding Swift is "generate a header we can already read", not a
// new reader -- which is a different and much smaller problem than WinRT below.
import UserNotifications

@objc public final class Scheduler: NSObject {
    private var tapHandler: ((String) -> Void)?

    @objc public func schedule(id: String, title: String, body: String, delayMillis: Double) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(delayMillis / 1000, 0.1), repeats: false)
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }

    @objc public func cancel(id: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
    }

    // Inbound. Called from the delegate on the main queue -- which IS the
    // runtime's thread under `host.ios`, so this is a direct call rather than an
    // inbox post. Android's equivalent is not, and that difference is a property
    // of the host rather than of the language.
    @objc public func setTapHandler(_ handler: @escaping (String) -> Void) {
        self.tapHandler = handler
    }
}
