// The oracle: `src/main.ts`'s application, written in Swift, line for line.
// Compiled with `swiftc` for the simulator on the lane's Mac, bundled from
// the TypeScript product's `Info.plist`, and run the same way; its output
// must be the TypeScript program's.
import UIKit

func report(_ line: String) {
  print(line)
  fflush(stdout)
}

class Form: NSObject, UITextFieldDelegate {
  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    report("return \(textField.text ?? "")")
    return false
  }
}

func typed(_ field: UITextField, _ text: String) {
  field.insertText(text)
}

class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  var form: Form?

  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let root = UIViewController()
    let field = UITextField(frame: CGRect(x: 20, y: 100, width: 280, height: 40))
    let form = Form()
    field.delegate = form
    root.view.addSubview(field)
    window.rootViewController = root
    window.makeKeyAndVisible()
    self.window = window
    self.form = form

    var changes = 0
    let center = NotificationCenter.default
    let observer = center.addObserver(forName: UITextField.textDidChangeNotification, object: field, queue: nil) { _ in
      changes += 1
      report("changed \(field.text ?? "") \(changes)")
    }
    report("first \(field.becomeFirstResponder())")
    typed(field, "hi")
    typed(field, "\n")
    let asked: Bool? = field.delegate?.textFieldShouldReturn?(field)
    report("asked \(asked.map { "\($0)" } ?? "none")")
    typed(field, "!")
    center.removeObserver(observer)
    typed(field, "?")
    report("quiet \(field.text ?? "") \(changes)")
    report("done")
    exit(0)
  }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
