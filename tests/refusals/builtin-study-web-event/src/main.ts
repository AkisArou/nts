// expect: NTS1001
// EventTarget and Event are independent causes in the archived compound probe.
// Within each pair only the constructed class changes.
class SourceTarget { name = "source target"; }
class SourceEvent { constructor(public type: string) {} }
export function subjectTarget(): void {
  const target = new EventTarget(); console.log("target", typeof target);
}
export function controlTarget(): void {
  const target = new SourceTarget(); console.log("target", typeof target);
}
export function subjectEvent(): void {
  const event = new Event("x"); console.log("event", event.type);
}
export function controlEvent(): void {
  const event = new SourceEvent("x"); console.log("event", event.type);
}
