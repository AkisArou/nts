export const cases = [
  { call: "switchStrict", why: "a switch matching with strict equality" },
  { call: "labelledBreak", why: "a labelled break leaving the outer loop" },
  { call: "labelledContinue", why: "a labelled continue skipping to the outer loop" },
  { call: "argumentOrder", why: "arguments evaluated left to right" },
  { call: "assignmentOrder", why: "the left side of an assignment evaluated first" },
  { call: "doWhileRunsOnce", why: "a do-while body running once" },
  { call: "forUpdateAfterBody", why: "a for loop's update running after the body" },
  { call: "recursion", why: "recursion to a depth of 100" },
];
