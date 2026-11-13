// The inverse of the catalogue's name-key encoding. Record readers consume
// this grammar; they do not guess an identifier character class.
import assert from "node:assert/strict";
export type NameCatalogue = {
  prefix: string;
  roles: {rust: string; stem: string; key: string; suffix?: string}[];
  name_escape: {ascii_literal: string; escaped_non_ascii: number[]};
};

export function nameLiteral(model: NameCatalogue, ch: string): boolean {
  const point = ch.codePointAt(0)!;
  if (point >= 0xd800 && point <= 0xdfff) return false;
  return point < 128 ? model.name_escape.ascii_literal.includes(ch)
    : !model.name_escape.escaped_non_ascii.includes(point);
}

/** Only canonical escapes decode: literal characters cannot be over-escaped. */
export function sourceName(model: NameCatalogue, member: string): {role: string; key: string} | null {
  for (const role of model.roles) {
    if (role.key !== "name") continue;
    const prefix = model.prefix + role.stem + "$";
    if (!member.startsWith(prefix)) continue;
    let key = "";
    const suffix = role.suffix ? "$" + role.suffix : "";
    if (!member.endsWith(suffix)) continue;
    const tail = member.slice(prefix.length, suffix ? -suffix.length : undefined);
    for (let at = 0; at < tail.length;) {
      const ch = String.fromCodePoint(tail.codePointAt(at)!);
      if (ch !== "$") {
        if (!nameLiteral(model, ch)) return null;
        key += ch;
        at += ch.length;
        continue;
      }
      const end = tail.indexOf("$", at + 1);
      if (end < 0) return null;
      const hex = tail.slice(at + 1, end);
      if (!/^(?:0|[1-9a-f][0-9a-f]*)$/.test(hex)) return null;
      const point = Number.parseInt(hex, 16);
      if (point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) return null;
      const decoded = String.fromCodePoint(point);
      if (nameLiteral(model, decoded)) return null;
      key += decoded;
      at = end + 1;
    }
    return {role: role.rust, key};
  }
  return null;
}

/** Remove only measured method tokens in the known reader's pin schema. */
export function withoutRecordedMethods(model: NameCatalogue, text: string): string {
  return text.split("\n").map(line => {
    if (!line.includes(model.prefix)) return line;
    const fields = line.split("\t");
    if (fields.length !== 3 || !fields[2]!.startsWith("pin: invalid=[")) return line;
    const pairs: unknown = JSON.parse(fields[2]!.slice("pin: invalid=".length));
    if (!Array.isArray(pairs) || pairs.length === 0) throw new Error("record pin must contain class/method pairs");
    const masked = pairs.map(pair => {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(part => typeof part === "string" && part.length > 0)) throw new Error("invalid record pin pair");
      if (!pair[1].includes(model.prefix)) return pair;
      const decoded = sourceName(model, pair[1]);
      if (decoded?.role !== "body" || decoded.key.length === 0) throw new Error("record pin is not a canonical source-body identity");
      return [pair[0], "<measured source body>"];
    });
    return [fields[0], fields[1], "pin: invalid=" + JSON.stringify(masked)].join("\t");
  }).join("\n");
}

/** Runs with every generation/check, including the gate's ordinary call. */
export function checkGrammar(model: NameCatalogue): void {
  assert(!model.name_escape.ascii_literal.includes("$"));
  const body = model.roles.find(role => role.rust === "body")!;
  const prefix = model.prefix + body.stem + "$";
  assert.deepEqual(sourceName(model, prefix + "Parser$23$skipWhiteSpace"), {role: "body", key: "Parser#skipWhiteSpace"});
  assert.deepEqual(sourceName(model, prefix + "東京"), {role: "body", key: "東京"});
  assert.deepEqual(sourceName(model, prefix + "x$24$23$24$"), {role: "body", key: "x$23$"});
  for (const bad of ["Parser#read", "$023$", "$2F$", "$41$", "$110000$", "$d800$", "$", "$g$"]) {
    assert.equal(sourceName(model, prefix + bad), null, `noncanonical name accepted: ${bad}`);
  }
  const method = prefix + "Parser$23$skipWhiteSpace";
  const pin = `fixture\twhy\tpin: invalid=${JSON.stringify([["Program", method]])}`;
  assert(!withoutRecordedMethods(model, pin).includes(model.prefix));
  assert(withoutRecordedMethods(model, pin.replace("why", method)).includes(model.prefix));
  assert(withoutRecordedMethods(model, `const member = ${JSON.stringify(method)}`).includes(model.prefix));
  assert.throws(() => withoutRecordedMethods(model, pin.replace("$23$", "$023$")));
}
