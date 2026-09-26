// A navigation controller's stack, as a Swift iOS programmer builds one: view
// controllers of the program's own that override the lifecycle UIKit drives
// -- `viewDidLoad`, `viewWillAppear`, `viewDidAppear` -- a push and a pop, and
// an animation whose completion takes the next step. Each step starts from
// the callback before it, so the order is UIKit's, not a timer's.
//
// The log, in order:
//   list loaded 2           the root's `viewDidLoad`, its items passed to its
//                           constructor
//   list will appear 1      and its `viewWillAppear`, `viewDidAppear`
//   list appeared 1
//   detail loaded banana    the pushed controller's `viewDidLoad`
//   detail appeared true    its `viewDidAppear`, and the stack's top is it
//   faded true 0            `UIView.animate`'s completion, the label faded
//   list will appear 2      the pop, and the root appearing again
//   list appeared 2
//   top Fruits              the stack's top, by its title
import {
  NSDictionary,
  UIApplication,
  UIApplicationMain,
  UILabel,
  UINavigationController,
  UIResponder,
  UIScreen,
  UIView,
  UIViewController,
  UIWindow,
  type UIApplicationDelegate,
} from "objc:UIKit";
import { exit } from "c:stdlib";
import type { c_int } from "c:types";

// Swift's `class ListController: UIViewController`.
class ListController extends UIViewController {
  appeared = 0;

  constructor(private readonly items: string[]) {
    super();
  }

  override viewDidLoad(): void {
    super.viewDidLoad();
    this.title = "Fruits";
    console.log(`list loaded ${this.items.length}`);
  }

  override viewWillAppear(animated: boolean): void {
    super.viewWillAppear(animated);
    console.log(`list will appear ${this.appeared + 1}`);
  }

  override viewDidAppear(animated: boolean): void {
    super.viewDidAppear(animated);
    this.appeared++;
    console.log(`list appeared ${this.appeared}`);
    if (this.appeared === 1) {
      this.open(this.items[1]);
      return;
    }
    console.log(`top ${this.navigationController?.topViewController?.title ?? "none"}`);
    exit(0 as c_int);
  }

  open(item: string): void {
    this.navigationController?.pushViewController(new DetailController(item), { animated: false });
  }
}

// Swift's `class DetailController: UIViewController`.
class DetailController extends UIViewController {
  label: UILabel | null = null;

  constructor(private readonly item: string) {
    super();
  }

  override viewDidLoad(): void {
    super.viewDidLoad();
    this.title = this.item;
    const label = new UILabel({ frame: { origin: { x: 20, y: 120 }, size: { width: 280, height: 40 } } });
    label.text = `about ${this.item}`;
    this.view.addSubview(label);
    this.label = label;
    // Swift's `completion: nil`: an optional closure left out.
    UIView.animate({ withDuration: 0, animations: () => (label.alpha = 1) }, null);
    console.log(`detail loaded ${this.item}`);
  }

  override viewDidAppear(animated: boolean): void {
    super.viewDidAppear(animated);
    console.log(`detail appeared ${this.navigationController?.topViewController === this}`);
    const label = this.label;
    UIView.animate({ withDuration: 0.1, animations: () => { if (label !== null) label.alpha = 0; } }, (finished) => {
      console.log(`faded ${finished} ${label?.alpha ?? -1}`);
      this.navigationController?.popViewController({ animated: false });
    });
  }
}

class AppDelegate extends UIResponder implements UIApplicationDelegate {
  window: UIWindow | null = null;

  applicationDidFinishLaunchingWithOptions(application: UIApplication, launchOptions: NSDictionary | null): boolean {
    const window = new UIWindow({ frame: UIScreen.main.bounds });
    window.rootViewController = new UINavigationController({ rootViewController: new ListController(["apple", "banana"]) });
    window.makeKeyAndVisible();
    this.window = window;
    return true;
  }
}

UIApplicationMain(0, null, null, "AppDelegate");
