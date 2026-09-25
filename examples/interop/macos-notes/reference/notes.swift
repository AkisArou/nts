// The oracle: `src/main.ts`'s application, written in Swift, line for line.
// Compiled with `swiftc` on the lane's Mac and run there. Its first run must
// print what the TypeScript program's first run prints. It saves to a file of
// its own, so the TypeScript runs' state is untouched.
import AppKit

let path = "/tmp/nts-macos-notes-swift.txt"

func report(_ line: String) {
  print(line)
  fflush(stdout)
}

// A length as TypeScript prints a number: `240`, not `240.0`.
func printed(_ value: CGFloat) -> String {
  value == value.rounded() ? String(Int(value)) : "\(value)"
}

func load() -> [String] {
  do {
    let text = try NSString(contentsOfFile: path, encoding: String.Encoding.utf8.rawValue)
    return text.components(separatedBy: "\n").filter { !$0.isEmpty }
  } catch {
    return []
  }
}

class Notes: NSObject, NSTableViewDataSource {
  private var notes: [String]
  private let field: NSTextField
  private let table: NSTableView

  init(notes: [String], field: NSTextField, table: NSTableView) {
    self.notes = notes
    self.field = field
    self.table = table
    super.init()
  }

  @objc func add(_ sender: NSObject) {
    let text = field.stringValue
    notes.append(text)
    field.stringValue = ""
    table.reloadData()
    report("added \(text)")
  }

  func numberOfRows(in tableView: NSTableView) -> Int {
    notes.count
  }

  func tableView(_ tableView: NSTableView, objectValueFor tableColumn: NSTableColumn?, row: Int) -> Any? {
    NSString(string: notes[row])
  }

  func save() -> Int {
    try? NSString(string: notes.joined(separator: "\n")).write(toFile: path, atomically: true, encoding: String.Encoding.utf8.rawValue)
    return notes.count
  }
}

func main() {
  let app = NSApplication.shared
  app.setActivationPolicy(.regular)
  let window = NSWindow(
    contentRect: NSRect(x: 200, y: 200, width: 360, height: 300),
    styleMask: [.titled, .closable],
    backing: .buffered,
    defer: false)
  window.title = "Notes"

  let field = NSTextField()
  let button = NSButton()
  button.title = "Add"
  let scroll = NSScrollView()
  let table = NSTableView()
  table.addTableColumn(NSTableColumn(identifier: NSUserInterfaceItemIdentifier("note")))
  scroll.documentView = table
  guard let content = window.contentView else { return }
  let views: [NSView] = [field, button, scroll]
  for view in views {
    view.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(view)
  }
  field.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 20).isActive = true
  field.topAnchor.constraint(equalTo: content.topAnchor, constant: 16).isActive = true
  field.trailingAnchor.constraint(equalTo: button.leadingAnchor, constant: -10).isActive = true
  button.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -20).isActive = true
  button.centerYAnchor.constraint(equalTo: field.centerYAnchor).isActive = true
  button.widthAnchor.constraint(equalToConstant: 70).isActive = true
  scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 20).isActive = true
  scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -20).isActive = true
  scroll.topAnchor.constraint(equalTo: field.bottomAnchor, constant: 16).isActive = true
  scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -20).isActive = true

  let loaded = load()
  let initially = loaded.count
  report("loaded \(initially)")
  content.layoutSubtreeIfNeeded()
  report("layout \(printed(field.frame.size.width)) \(printed(button.frame.origin.x)) \(printed(scroll.frame.size.height))")
  let notes = Notes(notes: loaded, field: field, table: table)
  table.dataSource = notes
  button.target = notes
  button.action = #selector(Notes.add(_:))
  window.makeKeyAndOrderFront(nil)

  var typed = 0
  Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { timer in
    typed += 1
    if typed <= 3 {
      field.stringValue = "note \(typed) of \(initially + typed)"
      button.performClick(nil)
      return
    }
    timer.invalidate()
    report("rows \(table.numberOfRows)")
    report("saved \(notes.save())")
    window.close()
    app.stop(nil)
    let wake = NSEvent.otherEvent(
      with: .applicationDefined,
      location: .zero,
      modifierFlags: [],
      timestamp: 0,
      windowNumber: 0,
      context: nil,
      subtype: 0,
      data1: 0,
      data2: 0)
    if let wake {
      app.postEvent(wake, atStart: true)
    }
  }
  app.run()
}

main()
