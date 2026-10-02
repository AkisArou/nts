// Evaluating this module throws, so every `import()` of it rejects -- with the
// same error each time, because a module is evaluated once.
export const before = 1;

throw new RangeError("thrower failed");
