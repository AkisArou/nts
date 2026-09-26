// A form field, as a Swift iOS programmer wires one: a text field whose
// delegate the program writes, a `NotificationCenter` observer for its
// changes -- a closure Foundation keeps until it is removed -- and typing,
// through the field's own `UIKeyInput` conformance.
//
// The log, in order:
//   first true              the field became the first responder
//   changed hi 1            `insertText` posted `textDidChangeNotification`,
//                           which reached the observer's closure
//   return hi               the field's delegate, asked through the field's
//   asked false             `delegate` as the protocol, and its answer
//   changed hi! 2           another insertion, observed
//   quiet hi!? 2            after `removeObserver`, one more is not
//   done
//
// An inserted "\n" is not the return key: UIKit neither calls the delegate
// nor changes the text for it, in Swift as here.
import {
  NSDictionary,
  NSNotification,
  NSObject,
  NotificationCenter,
  UIApplication,
  UIApplicationMain,
  UIResponder,
  UIScreen,
  UITextField,
  UIViewController,
  UIWindow,
  type UIApplicationDelegate,
  type UITextFieldDelegate,
} from "objc:UIKit";
import { exit } from "c:stdlib";
import { report } from "c:support";
import type { c_int } from "c:types";

// Swift's `class Form: NSObject, UITextFieldDelegate`.
class Form extends NSObject implements UITextFieldDelegate {
  textFieldShouldReturn(textField: UITextField): boolean {
    report(`return ${textField.text ?? ""}`);
    return false;
  }
}

function typed(field: UITextField, text: string): void {
  field.insertText(text);
}

class AppDelegate extends UIResponder implements UIApplicationDelegate {
  window: UIWindow | null = null;
  form: Form | null = null;

  applicationDidFinishLaunchingWithOptions(application: UIApplication, launchOptions: NSDictionary | null): boolean {
    const window = new UIWindow({ frame: UIScreen.main.bounds });
    const root = new UIViewController();
    const field = new UITextField({ frame: { origin: { x: 20, y: 100 }, size: { width: 280, height: 40 } } });
    const form = new Form();
    field.delegate = form;
    root.view.addSubview(field);
    window.rootViewController = root;
    window.makeKeyAndVisible();
    this.window = window;
    this.form = form;

    let changes = 0;
    const center = NotificationCenter.default;
    const observer = center.addObserver(
      { forName: UITextField.textDidChangeNotification, object: field, queue: null },
      (note: NSNotification) => {
        changes++;
        report(`changed ${field.text ?? ""} ${changes}`);
      },
    );
    report(`first ${field.becomeFirstResponder()}`);
    typed(field, "hi");
    typed(field, "\n");
    report(`asked ${field.delegate?.textFieldShouldReturn?.(field) ?? "none"}`);
    typed(field, "!");
    center.removeObserver(observer);
    typed(field, "?");
    report(`quiet ${field.text ?? ""} ${changes}`);
    report("done");
    exit(0 as c_int);
    return true;
  }
}

UIApplicationMain(0, null, null, "AppDelegate");
