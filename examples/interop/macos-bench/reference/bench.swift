// The same loops as src/main.ts, in Swift: Foundation from Swift's own importer.
import Foundation

func time(_ label: String, _ count: Int, _ body: () -> Int) {
  _ = body()
  let start = DispatchTime.now().uptimeNanoseconds
  let result = body()
  let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start)
  print("\(label) \(String(format: "%.1f", elapsed / Double(count))) ns/op (\(result))")
}

let number = NSNumber(value: 7)
time("send", 10_000_000) {
  var total = 0
  for _ in 0..<10_000_000 { total += Int(number.int32Value) }
  return total
}
let operation = Operation()
time("string-set", 1_000_000) {
  for _ in 0..<1_000_000 { operation.name = "worker" }
  return 1
}
time("string-get", 1_000_000) {
  var total = 0
  for _ in 0..<1_000_000 { total += (operation.name ?? "").utf16.count }
  return total
}
let csv = (0..<64).map { "item\($0)" }.joined(separator: ",") as NSString
time("array-out", 100_000) {
  var total = 0
  for _ in 0..<100_000 { total += csv.components(separatedBy: ",").count }
  return total
}
let parts = (0..<64).map { "p\($0)" }
time("array-in", 100_000) {
  var total = 0
  for _ in 0..<100_000 { total += NSString.path(withComponents: parts).utf16.count }
  return total
}
// A stored property of an Objective-C class, and of a plain one.
final class Tally: NSObject {
  var count = 0
  @inline(never) func bump() { count += 1 }
}
final class Plain {
  var count = 0
  @inline(never) func bump() { count += 1 }
}
let tally = Tally()
time("field", 10_000_000) {
  for _ in 0..<10_000_000 { tally.bump() }
  return tally.count
}
let plain = Plain()
time("plain-field", 10_000_000) {
  for _ in 0..<10_000_000 { plain.bump() }
  return plain.count
}
// A method a subclass overrides, called through the base's type. The object
// comes from a function the optimiser cannot see into, so the call is the
// class's vtable, not a devirtualized one.
class Shape: NSObject {
  func sides() -> Int { 0 }
}
class Square: Shape {
  override func sides() -> Int { 4 }
}
@inline(never) func made() -> Shape { Square() }
let shape = made()
time("override", 10_000_000) {
  var total = 0
  for _ in 0..<10_000_000 { total += shape.sides() }
  return total
}
let list = NSMutableArray()
time("objects-in", 100_000) {
  let numbers = [NSNumber(value: 1), NSNumber(value: 2), NSNumber(value: 3), NSNumber(value: 4)]
  for _ in 0..<100_000 { list.addObjects(from: numbers) }
  return list.count
}
