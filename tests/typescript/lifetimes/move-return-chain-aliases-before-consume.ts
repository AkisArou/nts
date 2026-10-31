/*---
description: Aliases returned through 34 calls own references beyond the original value final handoff.
features: [ts-lifetime-move, ts-route-return-chain, ts-functions, ts-iteration, ts-arrays, ts-strings, ts-objects]
---*/
// Fact: a last-use handoff moves its count (docs/foundations/memory.md, "Where nts stands").
// Route: 34 return wrappers retain two aliases before consumption; Node keeps their exact identity and fields.
type Cell = { id: number; text: string };
function make(id: number): Cell { return { id, text: "cell/" + id }; }
function consume(item: Cell): number { const destination = [item]; const checksum = destination[0].id + destination[0].text.length; destination.length = 0; return checksum; }
function first(item: Cell): Cell { return item; }
function relay0(item: Cell): Cell { return first(item); }
function relay1(item: Cell): Cell { return relay0(item); }
function relay2(item: Cell): Cell { return relay1(item); }
function relay3(item: Cell): Cell { return relay2(item); }
function relay4(item: Cell): Cell { return relay3(item); }
function relay5(item: Cell): Cell { return relay4(item); }
function relay6(item: Cell): Cell { return relay5(item); }
function relay7(item: Cell): Cell { return relay6(item); }
function relay8(item: Cell): Cell { return relay7(item); }
function relay9(item: Cell): Cell { return relay8(item); }
function relay10(item: Cell): Cell { return relay9(item); }
function relay11(item: Cell): Cell { return relay10(item); }
function relay12(item: Cell): Cell { return relay11(item); }
function relay13(item: Cell): Cell { return relay12(item); }
function relay14(item: Cell): Cell { return relay13(item); }
function relay15(item: Cell): Cell { return relay14(item); }
function relay16(item: Cell): Cell { return relay15(item); }
function relay17(item: Cell): Cell { return relay16(item); }
function relay18(item: Cell): Cell { return relay17(item); }
function relay19(item: Cell): Cell { return relay18(item); }
function relay20(item: Cell): Cell { return relay19(item); }
function relay21(item: Cell): Cell { return relay20(item); }
function relay22(item: Cell): Cell { return relay21(item); }
function relay23(item: Cell): Cell { return relay22(item); }
function relay24(item: Cell): Cell { return relay23(item); }
function relay25(item: Cell): Cell { return relay24(item); }
function relay26(item: Cell): Cell { return relay25(item); }
function relay27(item: Cell): Cell { return relay26(item); }
function relay28(item: Cell): Cell { return relay27(item); }
function relay29(item: Cell): Cell { return relay28(item); }
function relay30(item: Cell): Cell { return relay29(item); }
function relay31(item: Cell): Cell { return relay30(item); }
function relay32(item: Cell): Cell { return relay31(item); }
function relay33(item: Cell): Cell { return relay32(item); }

for (let n = 0; n < 256; n++) {
  const item = make(n);
  const kept = relay33(item), same = relay33(item);
  const expected = item.id + item.text.length;
  assert.sameValue(consume(item), expected);
  const rows: Cell[] = [];
  for (let i = 0; i < 24; i++) rows.push(make(n + 1000 + i));
  assert.sameValue(rows[23].id, n + 1023);
  assert.sameValue(kept === same, true);
  assert.sameValue(kept.id, n);
  assert.sameValue(kept.text, "cell/" + n);
  assert.sameValue(kept.text.length, ("cell/" + n).length);
}
