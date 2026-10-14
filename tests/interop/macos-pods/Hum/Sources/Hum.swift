// A pod written in Swift: its `@objc` class is what `objc:Hum` binds, from
// the header Swift writes for the module.
import Foundation

@objc public class Hum: NSObject {
    @objc public let tune: String

    @objc public init(tune: String) {
        self.tune = tune
    }

    @objc public func hummed(times: Int) -> String {
        Array(repeating: tune, count: times).joined(separator: "-")
    }
}
