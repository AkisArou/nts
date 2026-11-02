/*---
description: "Typed number parameters format fixed signed integers in every radix from two through thirty-six."
features: [ts-number-format-routes, ts-number-format-route-radix, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-strings, ts-readonly, ts-conversions]
---*/
// Two number parameters log the operand, radix and text; Node uses every digit alphabet through base 36 and formats either zero as "0".
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const inputs: readonly number[] = [0, -0, 1, -1, 35, -35, 255, -255, 65535, -65535];
const expected: string[][] = [
  ["0","0","1","-1","100011","-100011","11111111","-11111111","1111111111111111","-1111111111111111"], ["0","0","1","-1","1022","-1022","100110","-100110","10022220020","-10022220020"],
  ["0","0","1","-1","203","-203","3333","-3333","33333333","-33333333"], ["0","0","1","-1","120","-120","2010","-2010","4044120","-4044120"],
  ["0","0","1","-1","55","-55","1103","-1103","1223223","-1223223"], ["0","0","1","-1","50","-50","513","-513","362031","-362031"],
  ["0","0","1","-1","43","-43","377","-377","177777","-177777"], ["0","0","1","-1","38","-38","313","-313","108806","-108806"],
  ["0","0","1","-1","35","-35","255","-255","65535","-65535"], ["0","0","1","-1","32","-32","212","-212","45268","-45268"],
  ["0","0","1","-1","2b","-2b","193","-193","31b13","-31b13"], ["0","0","1","-1","29","-29","168","-168","23aa2","-23aa2"],
  ["0","0","1","-1","27","-27","143","-143","19c51","-19c51"], ["0","0","1","-1","25","-25","120","-120","14640","-14640"],
  ["0","0","1","-1","23","-23","ff","-ff","ffff","-ffff"], ["0","0","1","-1","21","-21","f0","-f0","d5d0","-d5d0"],
  ["0","0","1","-1","1h","-1h","e3","-e3","b44f","-b44f"], ["0","0","1","-1","1g","-1g","d8","-d8","9aa4","-9aa4"],
  ["0","0","1","-1","1f","-1f","cf","-cf","83gf","-83gf"], ["0","0","1","-1","1e","-1e","c3","-c3","71cf","-71cf"],
  ["0","0","1","-1","1d","-1d","bd","-bd","638j","-638j"], ["0","0","1","-1","1c","-1c","b2","-b2","58k8","-58k8"],
  ["0","0","1","-1","1b","-1b","af","-af","4hif","-4hif"], ["0","0","1","-1","1a","-1a","a5","-a5","44la","-44la"],
  ["0","0","1","-1","19","-19","9l","-9l","3iof","-3iof"], ["0","0","1","-1","18","-18","9c","-9c","38o6","-38o6"],
  ["0","0","1","-1","17","-17","93","-93","2rgf","-2rgf"], ["0","0","1","-1","16","-16","8n","-8n","2jqo","-2jqo"],
  ["0","0","1","-1","15","-15","8f","-8f","2cof","-2cof"], ["0","0","1","-1","14","-14","87","-87","2661","-2661"],
  ["0","0","1","-1","13","-13","7v","-7v","1vvv","-1vvv"], ["0","0","1","-1","12","-12","7o","-7o","1r5u","-1r5u"],
  ["0","0","1","-1","11","-11","7h","-7h","1mnh","-1mnh"], ["0","0","1","-1","10","-10","7a","-7a","1ihf","-1ihf"],
  ["0","0","1","-1","z","-z","73","-73","1ekf","-1ekf"],
];
function route(input: number, radix: number, basePosition: number, inputPosition: number, log: unknown[]): string {
  same(input, inputs[inputPosition]); same(radix, basePosition + 2); log.push("operand", input, radix);
  const text: string = input.toString(radix); log.push("text", text); return text;
}
let basePosition = 0;
for (const row of expected) {
  const radix: number = basePosition + 2; let inputPosition = 0;
  for (const input of inputs) {
    const log: unknown[] = [], text = route(input, radix, basePosition, inputPosition, log); same(text, row[inputPosition]);
    exact(log, ["operand", input, radix, "text", row[inputPosition]]); inputPosition++;
  }
  same(inputPosition, inputs.length); basePosition++;
}
same(basePosition, 35);
