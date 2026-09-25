// A notes application, as a Swift AppKit programmer writes one: a window
// with a text field, an Add button and a table of notes, whose controller is
// the button's target and the table's data source, and is handed what it
// controls when it is made. Notes are read from a file when it opens and
// written back once they are added. It drives itself -- three notes typed and
// added, then it quits -- so `build.sh` can run it twice and check that the
// second run finds what the first saved.
//
// The log, in order:
//   loaded N   notes read through `NSString(contentsOfFile:encoding:)`, which
//              throws on the first run, when there is no file
//   layout W X H  the field's width, the button's x and the list's height,
//              as Auto Layout placed them from the anchors' constraints
//   launched   the application delegate's `applicationDidFinishLaunching`,
//              which AppKit sends once `run` has started
//   added T    each note typed into the field and added by the button's
//              action -- the third by the main menu's Add item, the same
//              action -- which reads the field's `stringValue` and clears it
//   rows N     the table's `numberOfRows`, which asks the data source
//   saved N    the notes written back through `write(toFile:atomically:encoding:)`
import {
  NSApplication,
  NSButton,
  NSEvent,
  NSMenu,
  NSMenuItem,
  NSObject,
  NSScrollView,
  NSString,
  NSTableColumn,
  NSTableView,
  NSTextField,
  NSView,
  NSWindow,
  Timer,
  type NSApplicationDelegate,
  type NSNotification,
  type NSTableViewDataSource,
} from "objc:AppKit";
import { report } from "c:support";
import { selector } from "objc:runtime";
import type { Int } from "objc:types";

const PATH = "/tmp/nts-macos-notes.txt";
// `String.Encoding.utf8`, `NSUTF8StringEncoding`.
const UTF8 = 4;

// Swift's `try String(contentsOfFile:encoding:)`, which throws when there is
// no file yet: an empty list then.
function load(): string[] {
  try {
    const text = new NSString({ contentsOfFile: PATH, encoding: UTF8 });
    return text.components({ separatedBy: "\n" }).filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

// Swift's `class Notes: NSObject, NSTableViewDataSource`, whose `init` takes
// the notes and the views it works with.
class Notes extends NSObject implements NSTableViewDataSource {
  constructor(
    private readonly notes: string[],
    private readonly field: NSTextField,
    private readonly table: NSTableView,
  ) {
    super();
  }

  // The button's action, `add:`: the field's text as a note, and the table
  // told to ask again.
  add(sender: NSObject): void {
    const text = this.field.stringValue;
    this.notes.push(text);
    this.field.stringValue = "";
    this.table.reloadData();
    report(`added ${text}`);
  }

  // `NSTableViewDataSource`: how many rows, and what each shows.
  numberOfRows(tableView: NSTableView): Int {
    return this.notes.length;
  }

  tableViewObjectValueFor(tableView: NSTableView, tableColumn: NSTableColumn | null, row: Int): NSObject | null {
    return new NSString({ string: this.notes[row] });
  }

  save(): number {
    new NSString({ string: this.notes.join("\n") }).write({ toFile: PATH, atomically: true, encoding: UTF8 });
    return this.notes.length;
  }
}

// Swift's `class AppDelegate: NSObject, NSApplicationDelegate`: AppKit tells
// it the application has finished launching, once `run` has started it.
class AppDelegate extends NSObject implements NSApplicationDelegate {
  applicationDidFinishLaunching(notification: NSNotification): void {
    report("launched");
  }
}

function main(): void {
  const app = NSApplication.shared;
  app.setActivationPolicy(NSApplication.ActivationPolicy.regular);
  const window = new NSWindow({
    contentRect: { origin: { x: 200, y: 200 }, size: { width: 360, height: 300 } },
    styleMask: NSWindow.StyleMask.titled | NSWindow.StyleMask.closable,
    backing: NSWindow.BackingStoreType.buffered,
    defer: false,
  });
  window.title = "Notes";

  // Placed by Auto Layout, as Swift writes it with anchors: the field and the
  // button on one row, the list filling the rest.
  const field = new NSTextField();
  const button = new NSButton();
  button.title = "Add";
  const scroll = new NSScrollView();
  const table = new NSTableView();
  table.addTableColumn(new NSTableColumn({ identifier: "note" }));
  scroll.documentView = table;
  const content = window.contentView;
  if (content === null) {
    return;
  }
  const views: NSView[] = [field, button, scroll];
  for (const view of views) {
    view.translatesAutoresizingMaskIntoConstraints = false;
    content.addSubview(view);
  }
  field.leadingAnchor.constraint({ equalTo: content.leadingAnchor, constant: 20 }).isActive = true;
  field.topAnchor.constraint({ equalTo: content.topAnchor, constant: 16 }).isActive = true;
  field.trailingAnchor.constraint({ equalTo: button.leadingAnchor, constant: -10 }).isActive = true;
  button.trailingAnchor.constraint({ equalTo: content.trailingAnchor, constant: -20 }).isActive = true;
  button.centerYAnchor.constraint({ equalTo: field.centerYAnchor }).isActive = true;
  button.widthAnchor.constraint({ equalToConstant: 70 }).isActive = true;
  scroll.leadingAnchor.constraint({ equalTo: content.leadingAnchor, constant: 20 }).isActive = true;
  scroll.trailingAnchor.constraint({ equalTo: content.trailingAnchor, constant: -20 }).isActive = true;
  scroll.topAnchor.constraint({ equalTo: field.bottomAnchor, constant: 16 }).isActive = true;
  scroll.bottomAnchor.constraint({ equalTo: content.bottomAnchor, constant: -20 }).isActive = true;

  const loaded = load();
  // The controller keeps this array and adds to it, so its length is read
  // now, before any note is.
  const initially = loaded.length;
  report(`loaded ${initially}`);
  content.layoutSubtreeIfNeeded();
  report(`layout ${field.frame.size.width} ${button.frame.origin.x} ${scroll.frame.size.height}`);
  const notes = new Notes(loaded, field, table);
  table.dataSource = notes;
  button.target = notes;
  button.action = selector(Notes, "add");
  // A main menu whose item adds a note as the button does: Swift's
  // `NSMenuItem(title:action:keyEquivalent:)`, its target the controller.
  const menu = new NSMenu({ title: "Notes" });
  const item = new NSMenuItem({ title: "Add", action: selector(Notes, "add"), keyEquivalent: "n" });
  item.target = notes;
  menu.addItem(item);
  app.mainMenu = menu;
  const delegate = new AppDelegate();
  app.delegate = delegate;
  window.makeKeyAndOrderFront(null);

  // Typed and pressed from a timer, as a person would, then saved and quit.
  let typed = 0;
  Timer.scheduledTimer({ withTimeInterval: 0.05, repeats: true }, (timer) => {
    typed++;
    if (typed <= 3) {
      field.stringValue = `note ${typed} of ${initially + typed}`;
      // The last through the menu, as choosing Add there would.
      if (typed < 3) {
        button.performClick(null);
      } else {
        menu.performActionForItem({ at: 0 });
      }
      return;
    }
    timer.invalidate();
    report(`rows ${table.numberOfRows}`);
    report(`saved ${notes.save()}`);
    window.close();
    app.stop(null);
    // `stop:` is seen when the loop next finishes an event, so one is posted.
    const wake = NSEvent.otherEvent({
      with: NSEvent.EventType.applicationDefined,
      location: { x: 0, y: 0 },
      modifierFlags: 0,
      timestamp: 0,
      windowNumber: 0,
      context: null,
      subtype: 0,
      data1: 0,
      data2: 0,
    });
    if (wake !== null) {
      app.postEvent(wake, { atStart: true });
    }
  });
  app.run();
}

main();
