import Chirp
import Foundation

/// A Swift pod over another pod's Objective-C: `Chirp` is a module it
/// imports, as CocoaPods builds a pod whose dependency has modular headers.
@objc public class Echo: NSObject {
  @objc public func echoed(_ bird: String) -> String {
    let chirp = Chirp(bird: bird)
    return "\(chirp.song(withNotes: 2)) (echo)"
  }
}
