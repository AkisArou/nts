// A binding tag must retain the integer's digits. Each tagged value has the
// same bigint initializer for node; its control differs only by omitting the tag.
// In the old compiler the tag was parsed as f64, losing bits past 2^53.
/** @ntsConstant 9007199254740993 */
const positive: bigint = 9007199254740993n;
const positiveControl: bigint = 9007199254740993n;
/** @ntsConstant -9007199254740993 */
const negative: bigint = -9007199254740993n;
const negativeControl: bigint = -9007199254740993n;
/** @ntsConstant 9223372036854775807 */
const signedMax: bigint = 9223372036854775807n;
const signedMaxControl: bigint = 9223372036854775807n;
/** @ntsConstant 18446744073709551615 */
const unsignedMax: bigint = 18446744073709551615n;
const unsignedMaxControl: bigint = 18446744073709551615n;

export function positiveExact(): boolean { return positive === 9007199254740993n; }
export function positiveLiteral(): boolean { return positiveControl === 9007199254740993n; }
export function negativeExact(): boolean { return negative === -9007199254740993n; }
export function negativeLiteral(): boolean { return negativeControl === -9007199254740993n; }
export function signedEndpoint(): boolean { return signedMax === 9223372036854775807n; }
export function signedLiteral(): boolean { return signedMaxControl === 9223372036854775807n; }
export function unsignedEndpoint(): boolean { return unsignedMax === 18446744073709551615n; }
export function unsignedLiteral(): boolean { return unsignedMaxControl === 18446744073709551615n; }
