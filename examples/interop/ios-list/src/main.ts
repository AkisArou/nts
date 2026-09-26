// A table of fruits in a navigation controller, as a Swift iOS programmer
// writes one, run on the iOS simulator: a data source of the program's own,
// its cells dequeued or made, the table reloaded after the data changes, and
// a row selected.
//
// The log, in order:
//   title Fruits        the navigation bar's top item, the list's title
//   rows 3 visible 3    `numberOfRows(inSection:)`, asked of the data
//                       source, and the cells laid out
//   row 1 banana        the second cell's label, as the data source filled it
//   rows 4 last date    after an item is added and the table reloaded
//   selected 1          `indexPathForSelectedRow` after `selectRow`
//   asked 4             the table's `dataSource`, as the protocol, sent a
//                       requirement of it
//   tapped banana       the table's `delegate` sent an optional requirement,
//                       which the object implements
//   height -1           and not sent one it does not implement
//   header Fruits       a requirement answering a string, asked through
//                       the table's `dataSource`
//   window yes          `application.delegate?.window`: UIKit's view of the
//                       delegate's field, which meets the protocol's
//                       `window` requirement
//   plain none          the same requirement read from an adopter that does
//                       not meet it, which is not sent the getter
//   done                a timer, from the run loop UIKit runs, ending the run
import {
  NSDictionary,
  NSIndexPath,
  NSObject,
  Timer,
  UIApplication,
  UIApplicationMain,
  UINavigationController,
  UIResponder,
  UIScreen,
  UITableView,
  UITableViewCell,
  UIViewController,
  UIWindow,
  type UIApplicationDelegate,
  type UITableViewDataSource,
  type UITableViewDelegate,
} from "objc:UIKit";
import { exit } from "c:stdlib";
import type { c_int } from "c:types";
import type { Int } from "objc:types";

// Swift's `class Fruits: NSObject, UITableViewDataSource, UITableViewDelegate`.
class Fruits extends NSObject implements UITableViewDataSource, UITableViewDelegate {
  constructor(private readonly items: string[]) {
    super();
  }

  tableViewNumberOfRowsInSection(tableView: UITableView, section: Int): Int {
    return this.items.length;
  }

  tableViewCellForRowAt(tableView: UITableView, indexPath: NSIndexPath): UITableViewCell {
    const cell =
      tableView.dequeueReusableCell({ withIdentifier: "fruit" }) ??
      new UITableViewCell({ style: UITableViewCell.CellStyle.default, reuseIdentifier: "fruit" });
    const label = cell.textLabel;
    if (label !== null) {
      label.text = this.items[indexPath.row];
    }
    return cell;
  }

  // Swift's `func tableView(_:titleForHeaderInSection:) -> String?`: a
  // string answered, which UIKit receives as the `NSString` it asked for.
  tableViewTitleForHeaderInSection(tableView: UITableView, section: Int): string | null {
    return section === 0 ? "Fruits" : null;
  }

  tableViewDidSelectRowAt(tableView: UITableView, indexPath: NSIndexPath): void {
    console.log(`tapped ${this.items[indexPath.row]}`);
  }

  append(item: string): void {
    this.items.push(item);
  }
}

// The label of the row `row` shows, or `none`.
function shown(table: UITableView, row: number): string {
  return table.cellForRow({ at: new NSIndexPath({ forRow: row, inSection: 0 }) })?.textLabel?.text ?? "none";
}

// Adopts the protocol and meets none of its requirements, `window` among them.
class Plain extends NSObject implements UIApplicationDelegate {}

class AppDelegate extends UIResponder implements UIApplicationDelegate {
  window: UIWindow | null = null;
  fruits: Fruits | null = null;

  applicationDidFinishLaunchingWithOptions(application: UIApplication, launchOptions: NSDictionary | null): boolean {
    const window = new UIWindow({ frame: UIScreen.main.bounds });
    const list = new UIViewController();
    list.title = "Fruits";
    const table = new UITableView({ frame: list.view.bounds, style: UITableView.Style.plain });
    const fruits = new Fruits(["apple", "banana", "cherry"]);
    // The table holds its data source and delegate weakly, as Swift's
    // `weak var dataSource` says: the application delegate keeps it.
    table.dataSource = fruits;
    table.delegate = fruits;
    list.view.addSubview(table);
    const navigation = new UINavigationController({ rootViewController: list });
    window.rootViewController = navigation;
    window.makeKeyAndVisible();
    this.window = window;
    this.fruits = fruits;
    table.layoutIfNeeded();
    console.log(`title ${navigation.navigationBar.topItem?.title ?? "none"}`);
    console.log(`rows ${table.numberOfRows({ inSection: 0 })} visible ${table.visibleCells.length}`);
    console.log(`row 1 ${shown(table, 1)}`);
    fruits.append("date");
    table.reloadData();
    table.layoutIfNeeded();
    console.log(`rows ${table.numberOfRows({ inSection: 0 })} last ${shown(table, 3)}`);
    const second = new NSIndexPath({ forRow: 1, inSection: 0 });
    table.selectRow({ at: second, animated: false, scrollPosition: UITableView.ScrollPosition.none });
    console.log(`selected ${table.indexPathForSelectedRow?.row ?? -1}`);
    // Swift's `table.dataSource?.tableView(table, numberOfRowsInSection: 0)`
    // and `table.delegate?.tableView?(table, didSelectRowAt: second)`.
    console.log(`asked ${table.dataSource?.tableViewNumberOfRowsInSection(table, 0) ?? -1}`);
    table.delegate?.tableViewDidSelectRowAt?.(table, second);
    console.log(`height ${table.delegate?.tableViewHeightForRowAt?.(table, second) ?? -1}`);
    console.log(`header ${table.dataSource?.tableViewTitleForHeaderInSection?.(table, 0) ?? "none"}`);
    // Swift's `application.delegate?.window`, a `UIWindow??`: an `optional`
    // property requirement, read through the protocol.
    console.log(`window ${application.delegate?.window === window ? "yes" : "no"}`);
    const plain: UIApplicationDelegate = new Plain();
    console.log(`plain ${plain.window == null ? "none" : "some"}`);
    Timer.scheduledTimer({ withTimeInterval: 0.2, repeats: false }, () => {
      console.log("done");
      exit(0 as c_int);
    });
    return true;
  }
}

UIApplicationMain(0, null, null, "AppDelegate");
