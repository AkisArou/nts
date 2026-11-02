/*---
description: "String enum-member discriminants narrow interfaces to their distinct payload fields, including an aliased discriminant."
features: [ts-enum-computed, ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-literal-members, ts-enum, ts-enum-string, ts-interfaces, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-literal-types, ts-narrowing]
---*/
// A union of three enum-tagged interface layouts reaches one observer; node logs the selected payload field, exact payload kind and reference identity.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
enum PacketKind { Number = "n", Text = "t", Reference = "r", NumberAlias = Number }
interface NumericMemberPacket { kind: PacketKind.Number | PacketKind.NumberAlias; numeric: number; }
interface TextMemberPacket { kind: PacketKind.Text; text: string; }
interface ReferenceMemberPacket { kind: PacketKind.Reference; reference: { id: number }; }
type MemberPacket = NumericMemberPacket | TextMemberPacket | ReferenceMemberPacket;
const marker = { id: 7 }, other = { id: 7 };
const inputs: MemberPacket[] = [{ kind: PacketKind.Number, numeric: -0 }, { kind: PacketKind.Text, text: "" }, { kind: PacketKind.Reference, reference: marker }, { kind: PacketKind.NumberAlias, numeric: NaN }, { kind: PacketKind.Text, text: "tail" }, { kind: PacketKind.Reference, reference: other }];
const kinds = ["n", "t", "r", "n", "t", "r"], branches = ["number", "text", "reference", "number", "text", "reference"], answers: (number | string | { id: number })[] = [-0, "", marker, NaN, "tail", other];
function inspect(value: MemberPacket, log: unknown[]): number | string | { id: number } {
  if (value.kind === PacketKind.Number) { const kind: PacketKind.Number | PacketKind.NumberAlias = value.kind; log.push("number", kind, value.numeric, typeof value.numeric); return value.numeric; }
  if (value.kind === PacketKind.Text) { const kind: PacketKind.Text = value.kind; log.push("text", kind, value.text, typeof value.text); return value.text; }
  const kind: PacketKind.Reference = value.kind; log.push("reference", kind, value.reference, typeof value.reference); return value.reference;
}
for (let at = 0; at < inputs.length; at++) {
  const packet: MemberPacket = inputs[at], log: unknown[] = [], result = inspect(packet, log);
  same(packet, inputs[at]); same(packet.kind, kinds[at]); same(result, answers[at]); log.push("return", result);
  exact(log, [branches[at], kinds[at], answers[at], typeof answers[at], "return", answers[at]]);
}
