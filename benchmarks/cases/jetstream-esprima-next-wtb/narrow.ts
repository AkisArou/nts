// Checked readers for token unions at grammar-established sites.
export function stringValue(value: unknown): string {if (typeof value !== "string") throw new TypeError("Expected token string");return value;}
export function bigintValue(value: unknown): bigint {if (typeof value !== "bigint") throw new TypeError("Expected bigint token");return value;}
