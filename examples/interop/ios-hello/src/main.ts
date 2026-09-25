// A UIKit application, as a Swift iOS programmer writes one, run on the iOS
// simulator: an application delegate of the program's own, a window with a
// view controller, a label and a button whose action is a method of a class
// the program writes.
//
// The log, in order:
//   launched T K N  `application(_:didFinishLaunchingWithOptions:)`, sent by
//                   UIKit: the label's text, whether the window is key, and
//                   how many subviews the controller's view holds
//   pressed 1       the button's action, sent by `sendActions(for:)` as a tap
//                   would, reaching `Controller.pressed(_:)`
//   done            a timer, from the run loop UIKit runs, ending the run
import {
  NSDictionary,
  NSObject,
  Timer,
  UIApplication,
  UIButton,
  UIColor,
  UIControl,
  UILabel,
  UIResponder,
  UIScreen,
  UIViewController,
  UIWindow,
  type UIApplicationDelegate,
} from "objc:UIKit";
import { ios_exit, ios_main, report } from "c:support";
import { selector } from "objc:runtime";
import type { c_int } from "c:types";

// Swift's `class Controller: NSObject` with an `@objc func pressed(_:)`.
class Controller extends NSObject {
  presses = 0;

  pressed(sender: NSObject): void {
    this.presses++;
    report(`pressed ${this.presses}`);
  }
}

// Swift's `@main class AppDelegate: UIResponder, UIApplicationDelegate`.
class AppDelegate extends UIResponder implements UIApplicationDelegate {
  window: UIWindow | null = null;
  controller: Controller | null = null;

  applicationDidFinishLaunchingWithOptions(application: UIApplication, launchOptions: NSDictionary | null): boolean {
    const window = new UIWindow({ frame: UIScreen.main.bounds });
    const root = new UIViewController();
    root.view.backgroundColor = UIColor.systemBlue;
    const label = new UILabel({ frame: { origin: { x: 20, y: 100 }, size: { width: 300, height: 40 } } });
    label.text = "Hello from TypeScript";
    label.textColor = UIColor.white;
    root.view.addSubview(label);
    const controller = new Controller();
    const button = new UIButton({ frame: { origin: { x: 20, y: 160 }, size: { width: 120, height: 44 } } });
    button.addTarget(controller, { action: selector(Controller, "pressed"), for: UIControl.Event.touchUpInside });
    root.view.addSubview(button);
    window.rootViewController = root;
    window.makeKeyAndVisible();
    this.window = window;
    this.controller = controller;
    report(`launched ${label.text} ${window.isKeyWindow} ${root.view.subviews.length}`);
    button.sendActions({ for: UIControl.Event.touchUpInside });
    Timer.scheduledTimer({ withTimeInterval: 0.2, repeats: false }, () => {
      report("done");
      ios_exit(0 as c_int);
    });
    return true;
  }
}

ios_main("AppDelegate");
