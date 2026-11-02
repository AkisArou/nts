/*---
description: "Control for member-interface-discriminants; String enum-member discriminants narrow interfaces to their distinct payload fields, including an aliased discriminant."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-literal-members, ts-interfaces, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-literal-types, ts-narrowing]
---*/
// A union of three enum-tagged interface layouts reaches one observer; node logs the selected payload field, exact payload kind and reference identity. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const PacketKind = Object.freeze({ Number: "n", Text: "t", Reference: "r", NumberAlias: "n" }); type PacketKind = "n" | "t" | "r";
interface NumericMemberPacket { kind: "n"; numeric: number; }
interface TextMemberPacket { kind: "t"; text: string; }
interface ReferenceMemberPacket { kind: "r"; reference: { id: number }; }
type MemberPacket = NumericMemberPacket | TextMemberPacket | ReferenceMemberPacket;
const marker = { id: 7 }, other = { id: 7 };
const inputs: MemberPacket[] = [{ kind: PacketKind.Number, numeric: -0 }, { kind: PacketKind.Text, text: "" }, { kind: PacketKind.Reference, reference: marker }, { kind: PacketKind.NumberAlias, numeric: NaN }, { kind: PacketKind.Text, text: "tail" }, { kind: PacketKind.Reference, reference: other }];
const kinds = ["n", "t", "r", "n", "t", "r"], branches = ["number", "text", "reference", "number", "text", "reference"], answers: (number | string | { id: number })[] = [-0, "", marker, NaN, "tail", other];
function inspect(value: MemberPacket, log: unknown[]): number | string | { id: number } {
  if (value.kind === PacketKind.Number) { const kind: "n" = value.kind; log.push("number", kind, value.numeric, typeof value.numeric); return value.numeric; }
  if (value.kind === PacketKind.Text) { const kind: "t" = value.kind; log.push("text", kind, value.text, typeof value.text); return value.text; }
  const kind: "r" = value.kind; log.push("reference", kind, value.reference, typeof value.reference); return value.reference;
}
for (let at = 0; at < inputs.length; at++) {
  const packet: MemberPacket = inputs[at], log: unknown[] = [], result = inspect(packet, log);
  same(packet, inputs[at]); same(packet.kind, kinds[at]); same(result, answers[at]); log.push("return", result);
  exact(log, [branches[at], kinds[at], answers[at], typeof answers[at], "return", answers[at]]);
}
