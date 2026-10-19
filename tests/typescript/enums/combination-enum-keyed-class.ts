/*---
description: A generic class keyed by a string enum, through an interface, holds one value per member.
features: [ts-enum, ts-enum-string, ts-generics, ts-class, ts-interfaces]
---*/
enum Channel { Email = "email", Sms = "sms" }
interface Settings<T> {
  get(channel: Channel): T;
}
class PerChannel<T> implements Settings<T> {
  private values: Record<Channel, T>;
  constructor(email: T, sms: T) {
    this.values = { [Channel.Email]: email, [Channel.Sms]: sms };
  }
  get(channel: Channel): T {
    return this.values[channel];
  }
}
const limits: Settings<number> = new PerChannel(100, 5);
assert.sameValue(limits.get(Channel.Sms), 5);
const labels: Settings<string> = new PerChannel("E", "S");
assert.sameValue(labels.get(Channel.Email), "E");
