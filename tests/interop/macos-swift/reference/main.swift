// The oracle: `src/main.ts` in Swift, compiled with the module's sources,
// printing the same lines.
import Foundation

final class Watcher: NSObject, GreeterDelegate {
    var shout = false
    func greeter(_ greeter: Greeter, didGreet name: String) {
        print("delegate greeted \(name)")
    }
    func greeterShouldShout(_ greeter: Greeter) -> Bool { shout }
}

func greetings(_ watcher: Watcher) -> Int {
    let greeter = Greeter(name: "nts")
    let watch = Watch.watch(greeter)
    print("greet \(greeter.greet(times: 2))")
    print("name \(greeter.name)")
    greeter.name = "world"
    print("renamed \(greeter.greet(times: 1))")
    print("count \(Greeter.greetingCount)")
    greeter.delegate = watcher
    print("quiet \(greeter.greet(times: 1))")
    watcher.shout = true
    print("shouted \(greeter.greet(times: 1))")
    watcher.shout = false
    let done = DispatchSemaphore(value: 0)
    var later = 0
    greeter.greetLater { count in
        later = count
        done.signal()
    }
    done.wait()
    print("later \(later)")
    return watch
}

@main
struct Main {
    static func main() {
        let watcher = Watcher()
        let watch = autoreleasepool { greetings(watcher) }
        print("greeter \(Watch.isAlive(watch) ? "alive" : "gone")")
    }
}
