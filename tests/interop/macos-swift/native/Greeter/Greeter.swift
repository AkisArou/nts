// The project's own Swift, which the program imports as `objc:Greeter`: this
// directory is the module, as a SwiftPM target is, and `nts build` compiles
// it and binds the Objective-C header Swift writes for it.
import Foundation

/// A protocol a TypeScript class adopts: one required method, one optional.
@objc public protocol GreeterDelegate: NSObjectProtocol {
    func greeter(_ greeter: Greeter, didGreet name: String)
    @objc optional func greeterShouldShout(_ greeter: Greeter) -> Bool
}

@objc public class Greeter: NSObject {
    @objc public var name: String
    @objc public weak var delegate: GreeterDelegate?

    @objc public init(name: String) {
        self.name = name
    }

    @objc public func greet(times: Int) -> String {
        Greeter.greetings += 1
        let greeting = Array(repeating: "hello \(name)", count: times).joined(separator: ", ")
        delegate?.greeter(self, didGreet: name)
        if delegate?.greeterShouldShout?(self) == true {
            return greeting.uppercased()
        }
        return greeting
    }

    /// Completes on another thread, as a framework's completion handler may,
    /// with how many greetings there have been.
    @objc public func greetLater(completion: @escaping (Int) -> Void) {
        _ = greet(times: 1)
        let count = Greeter.greetings
        DispatchQueue.global().async { completion(count) }
    }

    @objc public static var greetingCount: Int { greetings }

    static var greetings = 0
}
