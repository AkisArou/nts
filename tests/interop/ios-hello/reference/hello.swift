// The oracle: `src/main.ts`'s application, written in Swift, line for line.
// Compiled with `swiftc` for the simulator on the lane's Mac, bundled from
// the TypeScript product's `Info.plist`, and run the same way; its output
// must be the TypeScript program's.
import UIKit

func report(_ line: String) {
  print(line)
  fflush(stdout)
}

class Controller: NSObject {
  var presses = 0

  @objc func pressed(_ sender: NSObject) {
    presses += 1
    report("pressed \(presses)")
  }
}

class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  var controller: Controller?

  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let root = UIViewController()
    root.view.backgroundColor = .systemBlue
    let label = UILabel(frame: CGRect(x: 20, y: 100, width: 300, height: 40))
    label.text = "Hello from TypeScript"
    label.textColor = .white
    root.view.addSubview(label)
    let controller = Controller()
    let button = UIButton(frame: CGRect(x: 20, y: 160, width: 120, height: 44))
    button.addTarget(controller, action: #selector(Controller.pressed(_:)), for: .touchUpInside)
    root.view.addSubview(button)
    window.rootViewController = root
    window.makeKeyAndVisible()
    self.window = window
    self.controller = controller
    report("launched \(label.text ?? "") \(window.isKeyWindow) \(root.view.subviews.count)")
    button.sendActions(for: .touchUpInside)
    Timer.scheduledTimer(withTimeInterval: 0.2, repeats: false) { _ in
      report("done")
      exit(0)
    }
    return true
  }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
