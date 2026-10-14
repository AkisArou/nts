import Foundation

/// Zeroing weak references, by which an object's release is seen: a second
/// file of the module, compiled with the first as one.
@objc public class Watch: NSObject {
    private static var watched: [Weak] = []

    @objc public static func watch(_ object: NSObject) -> Int {
        watched.append(Weak(object))
        return watched.count - 1
    }

    @objc public static func isAlive(_ watch: Int) -> Bool {
        watched[watch].object != nil
    }
}

private final class Weak {
    weak var object: NSObject?
    init(_ object: NSObject) { self.object = object }
}
