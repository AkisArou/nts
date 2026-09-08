// The shared JSON corpora.
//
// One list, imported by every JSON test, because two copies of "valid JSON" drift and the
// drift is invisible: a case dropped from one file still passes in the other.
//
// Every control character and space-like character is a `\u` escape. These are exactly the
// cases where the byte is the point, and a raw one is unreadable in a diff.

/** Text that is valid per ECMA-404, so node parses it and so must this implementation. */
export const VALID: readonly string[] = [
  "null",
  "true",
  "false",
  '""',
  '"a"',
  "0",
  "-0",
  "1",
  "-1",
  "1.5",
  "-1.5",
  "1e3",
  "1E3",
  "1e+3",
  "1e-3",
  "1.5e300",
  "1e400",
  "0.0",
  "-0.0",
  "123456789012345678901234567890",
  "1e-400",
  "[]",
  "{}",
  "[1]",
  "[1,2,3]",
  '{"a":1}',
  '{"a":1,"b":2}',
  '{"a":{"b":{"c":[1,2,{"d":null}]}}}',
  "[[[[[1]]]]]",
  '{"":1}',
  '{"a":[],"b":{}}',
  '"\\u0000"',
  '"\\u001f"',
  '"\\"\\\\\\/\\b\\f\\n\\r\\t"',
  '"\\ud83d\\ude00"',
  '"\\ud800"',
  '"\\udc00"',
  '"\\ud800a"',
  '"\\udfff\\ud800"',
  '"é"',
  '"日本語"',
  " \t\r\n null \t\r\n ",
  "[ 1 , 2 ]",
  '{ "a" : 1 }',
  '{"b":1,"0":2,"1":3,"a":4}',
  '{"a":1,"a":2}',
  '{"01":1,"-1":2,"1.5":3,"4294967295":4,"4294967294":5}',
  '{"__proto__":1}',
  '{"constructor":1,"toString":2}',
];


/**
 * Text that is not valid JSON, most of it valid JavaScript.
 *
 * The corpus is only meaningful alongside the assertion that node rejects each one too:
 * without that control it says the parser is strict, not that it is strict about the right
 * things, and a parser that rejected everything would pass.
 */
export const INVALID: readonly string[] = [
  // Nothing, and not-quite-literals.
  "",
  " ",
  "\n",
  "nul",
  "tru",
  "fals",
  "NULL",
  "True",
  "undefined",
  // Numbers JavaScript accepts and JSON does not.
  "NaN",
  "Infinity",
  "-Infinity",
  "+1",
  "01",
  "-01",
  ".5",
  "5.",
  "1.",
  "1.e3",
  "1e",
  "1e+",
  "1e-",
  "--1",
  "0x10",
  "0b1",
  "1_000",
  // Object and array syntax JavaScript accepts and JSON does not.
  "'a'",
  "a",
  "{a:1}",
  "{'a':1}",
  '{"a" 1}',
  '{"a":}',
  "{:1}",
  "[1,]",
  "[,1]",
  "[1 2]",
  '{"a":1,}',
  "{,}",
  "[}",
  "{]",
  // Strings.
  '"',
  '"a',
  '"\\"',
  '"\\x41"',
  '"\\u12"',
  '"\\u12g4"',
  '"\\q"',
  '"\n"',
  '"\t"',
  '"\u0000"',
  // More than one value, and non-JSON whitespace between tokens.
  "[1] [2]",
  "1 2",
  "{} {}",
  "nullnull",
  "\ufeff{}",
  "\u00a0null",
  "\u2028null",
  // Truncated, and comments.
  "[",
  "{",
  '{"a"',
  '{"a":',
  "[1",
  "/*c*/1",
  "1//c",
];

