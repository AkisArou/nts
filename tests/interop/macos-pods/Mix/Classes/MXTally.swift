import Foundation

/// The pod's Swift half, counting with its Objective-C half -- a class of the
/// same module, which Swift sees without importing anything.
@objc public class MXTally: NSObject {
  private let counter = MXCounter()

  @objc public func twice() -> Int {
    counter.next() + counter.next()
  }

  @objc public func summary() -> String {
    counter.summary()
  }
}

/// What the Objective-C half asks the Swift half for.
@objc public class MXWording: NSObject {
  @objc public static func counted(_ count: Int) -> String {
    "counted \(count)"
  }
}
