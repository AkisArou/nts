// LocalAuthentication, in Swift. Pretend-supported, same route as notifications.
import LocalAuthentication

@objc public final class Prompt: NSObject {
    @objc public func authenticate(reason: String, completion: @escaping (Bool) -> Void) {
        let context = LAContext()
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, _ in
            completion(ok)
        }
    }
}
