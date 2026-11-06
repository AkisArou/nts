// The control for a-static-field-defined-twice: the same two static fields,
// the second under another name, so nothing is defined twice. It agrees with
// node ("test262").
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
