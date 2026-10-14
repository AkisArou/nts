import CBlink
import Foundation

@objc public class Blink: NSObject {
    @objc public let times: Int

    @objc public init(times: Int) {
        self.times = times
    }

    @objc public func pattern() -> String {
        Array(repeating: "*", count: times).joined(separator: " ")
    }

    /// Its rate, from the package's C target.
    @objc public func rate() -> Int {
        Int(cblink_rate(Int32(times)))
    }
}
