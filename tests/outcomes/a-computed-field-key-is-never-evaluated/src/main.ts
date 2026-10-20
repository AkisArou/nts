// run: check
// The program is `case.js`: unchecked JavaScript, since typed TypeScript
// refuses a computed field key that is not a literal (TS1166). See its header.
export { staticField, instanceField, constantKey } from "./case.js";
