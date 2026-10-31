/*---
description: A string returned through 34 borrowed parameter summaries remains owned by its recipient.
features: [ts-lifetime-borrow, ts-route-return-chain, ts-functions, ts-iteration, ts-arrays, ts-strings]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: 34 returns keep the string after its input slot is cleared; Node keeps exact text and length.
function word(n: number): string { return String.fromCharCode(97 + n % 26) + ":" + n; }
function first(text: string): string { return text; }
function relay0(text: string): string { return first(text); }
function relay1(text: string): string { return relay0(text); }
function relay2(text: string): string { return relay1(text); }
function relay3(text: string): string { return relay2(text); }
function relay4(text: string): string { return relay3(text); }
function relay5(text: string): string { return relay4(text); }
function relay6(text: string): string { return relay5(text); }
function relay7(text: string): string { return relay6(text); }
function relay8(text: string): string { return relay7(text); }
function relay9(text: string): string { return relay8(text); }
function relay10(text: string): string { return relay9(text); }
function relay11(text: string): string { return relay10(text); }
function relay12(text: string): string { return relay11(text); }
function relay13(text: string): string { return relay12(text); }
function relay14(text: string): string { return relay13(text); }
function relay15(text: string): string { return relay14(text); }
function relay16(text: string): string { return relay15(text); }
function relay17(text: string): string { return relay16(text); }
function relay18(text: string): string { return relay17(text); }
function relay19(text: string): string { return relay18(text); }
function relay20(text: string): string { return relay19(text); }
function relay21(text: string): string { return relay20(text); }
function relay22(text: string): string { return relay21(text); }
function relay23(text: string): string { return relay22(text); }
function relay24(text: string): string { return relay23(text); }
function relay25(text: string): string { return relay24(text); }
function relay26(text: string): string { return relay25(text); }
function relay27(text: string): string { return relay26(text); }
function relay28(text: string): string { return relay27(text); }
function relay29(text: string): string { return relay28(text); }
function relay30(text: string): string { return relay29(text); }
function relay31(text: string): string { return relay30(text); }
function relay32(text: string): string { return relay31(text); }
function relay33(text: string): string { return relay32(text); }

for (let n = 0; n < 256; n++) {
  const owner = [word(n)];
  const kept = relay33(owner[0]);
  owner.length = 0;
  const words: string[] = [];
  for (let i = 0; i < 24; i++) words.push(word(n + i + 1000));
  assert.sameValue(words[23].length > 0, true);
  assert.sameValue(kept, String.fromCharCode(97 + n % 26) + ":" + n);
  assert.sameValue(kept.length, (String.fromCharCode(97 + n % 26) + ":" + n).length);
}
