// The oracle: `src/main.ts`'s application, written in Swift, line for line.
// Compiled with `swiftc` for the simulator on the lane's Mac, bundled from
// the TypeScript product's `Info.plist`, and run the same way; its output
// must be the TypeScript program's.
import UIKit

func report(_ line: String) {
  print(line)
  fflush(stdout)
}

class Fruits: NSObject, UITableViewDataSource, UITableViewDelegate {
  private var items: [String]

  init(items: [String]) {
    self.items = items
    super.init()
  }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    items.count
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell =
      tableView.dequeueReusableCell(withIdentifier: "fruit")
      ?? UITableViewCell(style: .default, reuseIdentifier: "fruit")
    if let label = cell.textLabel {
      label.text = items[indexPath.row]
    }
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    report("tapped \(items[indexPath.row])")
  }

  func append(_ item: String) {
    items.append(item)
  }
}

func shown(_ table: UITableView, _ row: Int) -> String {
  table.cellForRow(at: IndexPath(row: row, section: 0))?.textLabel?.text ?? "none"
}

class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  var fruits: Fruits?

  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let list = UIViewController()
    list.title = "Fruits"
    let table = UITableView(frame: list.view.bounds, style: .plain)
    let fruits = Fruits(items: ["apple", "banana", "cherry"])
    table.dataSource = fruits
    table.delegate = fruits
    list.view.addSubview(table)
    let navigation = UINavigationController(rootViewController: list)
    window.rootViewController = navigation
    window.makeKeyAndVisible()
    self.window = window
    self.fruits = fruits
    table.layoutIfNeeded()
    report("title \(navigation.navigationBar.topItem?.title ?? "none")")
    report("rows \(table.numberOfRows(inSection: 0)) visible \(table.visibleCells.count)")
    report("row 1 \(shown(table, 1))")
    fruits.append("date")
    table.reloadData()
    table.layoutIfNeeded()
    report("rows \(table.numberOfRows(inSection: 0)) last \(shown(table, 3))")
    let second = IndexPath(row: 1, section: 0)
    table.selectRow(at: second, animated: false, scrollPosition: .none)
    report("selected \(table.indexPathForSelectedRow?.row ?? -1)")
    report("asked \(table.dataSource?.tableView(table, numberOfRowsInSection: 0) ?? -1)")
    table.delegate?.tableView?(table, didSelectRowAt: second)
    report("height \(Int(table.delegate?.tableView?(table, heightForRowAt: second) ?? -1))")
    Timer.scheduledTimer(withTimeInterval: 0.2, repeats: false) { _ in
      report("done")
      exit(0)
    }
    return true
  }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
