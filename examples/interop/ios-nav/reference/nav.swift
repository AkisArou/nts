// The oracle: `src/main.ts`'s application, written in Swift, line for line.
// Compiled with `swiftc` for the simulator on the lane's Mac, bundled from
// the TypeScript product's `Info.plist`, and run the same way; its output
// must be the TypeScript program's.
import UIKit

func report(_ line: String) {
  print(line)
  fflush(stdout)
}

class ListController: UIViewController {
  var appeared = 0
  private let items: [String]

  init(items: [String]) {
    self.items = items
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Fruits"
    report("list loaded \(items.count)")
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    report("list will appear \(appeared + 1)")
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    appeared += 1
    report("list appeared \(appeared)")
    if appeared == 1 {
      open(items[1])
      return
    }
    report("top \(navigationController?.topViewController?.title ?? "none")")
    exit(0)
  }

  func open(_ item: String) {
    navigationController?.pushViewController(DetailController(item: item), animated: false)
  }
}

class DetailController: UIViewController {
  var label: UILabel?
  private let item: String

  init(item: String) {
    self.item = item
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = item
    let label = UILabel(frame: CGRect(x: 20, y: 120, width: 280, height: 40))
    label.text = "about \(item)"
    view.addSubview(label)
    self.label = label
    UIView.animate(withDuration: 0, animations: { label.alpha = 1 }, completion: nil)
    report("detail loaded \(item)")
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    report("detail appeared \(navigationController?.topViewController === self)")
    let label = self.label
    UIView.animate(withDuration: 0.1, animations: { label?.alpha = 0 }) { finished in
      report("faded \(finished) \(label.map { Int($0.alpha) } ?? -1)")
      self.navigationController?.popViewController(animated: false)
    }
  }
}

class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = UINavigationController(rootViewController: ListController(items: ["apple", "banana"]))
    window.makeKeyAndVisible()
    self.window = window
    return true
  }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
