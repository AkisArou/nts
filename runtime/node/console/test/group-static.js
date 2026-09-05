"use strict";

// Every supported assertion from pinned upstream
// `parallel/test-console-group.js`. The only omitted block enumerates the
// global console with Reflect.ownKeys and invokes Object.prototype directly;
// that block remains explicitly N/A under §13.
require("../common");

const assert = require("node:assert");
const { Console } = require("node:console");

function capture(groupIndentation) {
  let stdout = "";
  let stderr = "";
  const out = {
    write(text) {
      stdout += text;
      return true;
    },
  };
  const err = {
    write(text) {
      stderr += text;
      return true;
    },
  };
  const instance = new Console({
    stdout: out,
    stderr: err,
    colorMode: false,
    groupIndentation,
  });
  return {
    instance,
    output() {
      return { stdout, stderr };
    },
  };
}

{
  const { instance, output } = capture();
  instance.log("This is the outer level");
  instance.group();
  instance.log("Level 2");
  instance.group();
  instance.log("Level 3");
  instance.warn("More of level 3");
  instance.groupEnd();
  instance.log("Back to level 2");
  instance.groupEnd();
  instance.log("Back to the outer level");
  instance.groupEnd();
  instance.log("Still at the outer level");
  assert.deepStrictEqual(output(), {
    stdout:
      "This is the outer level\n" +
      "  Level 2\n" +
      "    Level 3\n" +
      "  Back to level 2\n" +
      "Back to the outer level\n" +
      "Still at the outer level\n",
    stderr: "    More of level 3\n",
  });
}

{
  let stdout = "";
  const stream = {
    write(text) {
      stdout += text;
      return true;
    },
  };
  const first = new Console(stream, stream);
  const second = new Console(stream, stream);
  first.log("No indentation");
  second.log("None here either");
  first.group();
  first.log("Now the first console is indenting");
  second.log("But the second one does not");
  assert.strictEqual(
    stdout,
    "No indentation\n" +
      "None here either\n" +
      "  Now the first console is indenting\n" +
      "But the second one does not\n",
  );
}

{
  const { instance, output } = capture();
  instance.group("This is a label");
  instance.log("And this is the data for that label");
  assert.deepStrictEqual(output(), {
    stdout: "This is a label\n  And this is the data for that label\n",
    stderr: "",
  });
}

{
  const { instance, output } = capture();
  instance.groupCollapsed("Label");
  instance.log("Level 2");
  instance.groupCollapsed();
  instance.log("Level 3");
  assert.deepStrictEqual(output(), {
    stdout: "Label\n  Level 2\n    Level 3\n",
    stderr: "",
  });
}

{
  const { instance, output } = capture();
  instance.log("not indented");
  instance.group();
  instance.log("indented\nalso indented");
  instance.log({
    also: "a",
    multiline: "object",
    should: "be",
    indented: "properly",
    kthx: "bai",
  });
  assert.deepStrictEqual(output(), {
    stdout:
      "not indented\n" +
      "  indented\n" +
      "  also indented\n" +
      "  {\n" +
      "    also: 'a',\n" +
      "    multiline: 'object',\n" +
      "    should: 'be',\n" +
      "    indented: 'properly',\n" +
      "    kthx: 'bai'\n" +
      "  }\n",
    stderr: "",
  });
}

{
  const { instance, output } = capture(3);
  instance.log("Set the groupIndentation parameter to 3");
  instance.log("This is the outer level");
  instance.group();
  instance.log("Level 2");
  instance.group();
  instance.log("Level 3");
  instance.warn("More of level 3");
  instance.groupEnd();
  instance.log("Back to level 2");
  instance.groupEnd();
  instance.log("Back to the outer level");
  instance.groupEnd();
  instance.log("Still at the outer level");
  assert.deepStrictEqual(output(), {
    stdout:
      "Set the groupIndentation parameter to 3\n" +
      "This is the outer level\n" +
      "   Level 2\n" +
      "      Level 3\n" +
      "   Back to level 2\n" +
      "Back to the outer level\n" +
      "Still at the outer level\n",
    stderr: "      More of level 3\n",
  });
}

const stream = { write() {} };
for (const groupIndentation of [null, "str", [], false, true, {}]) {
  assert.throws(() => new Console({ stdout: stream, stderr: stream, groupIndentation }), {
    code: "ERR_INVALID_ARG_TYPE",
    name: "TypeError",
  });
}
for (const groupIndentation of [NaN, 1.01]) {
  assert.throws(() => new Console({ stdout: stream, stderr: stream, groupIndentation }), {
    code: "ERR_OUT_OF_RANGE",
    name: "RangeError",
    message: /an integer/,
  });
}
for (const groupIndentation of [-1, 1001]) {
  assert.throws(() => new Console({ stdout: stream, stderr: stream, groupIndentation }), {
    code: "ERR_OUT_OF_RANGE",
    name: "RangeError",
    message: />= 0 && <= 1000/,
  });
}
