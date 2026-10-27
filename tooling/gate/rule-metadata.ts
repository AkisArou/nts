import { isDeepStrictEqual } from "node:util";

export type RuleMetadata = {
  wide?: boolean;
  full?: boolean;
  arms?: readonly unknown[];
  precise?: boolean;
};
const POLICIES = { wide: "any", full: "any", arms: "union", precise: "all" } as const;

/** Every path adds obligations. `precise` is an exemption from ordinary
 * selection, so it survives only when every contribution is explicitly precise.
 * Arms keep first-seen presentation order; membership is an order-independent
 * union. Deep equality preserves distinct run callbacks instead of dropping
 * functions as JSON equality would.
 */
export function mergeRuleMetadata(previous: RuleMetadata | undefined, next: RuleMetadata): Required<RuleMetadata> {
  for (const field of Object.keys(next)) {
    if (!Object.hasOwn(POLICIES, field)) throw new Error(`no rule metadata merge policy for ${field}`);
  }
  const merged: Record<string, unknown> = {};
  for (const [field, policy] of Object.entries(POLICIES)) {
    const key = field as keyof RuleMetadata;
    const left = previous?.[key], right = next[key];
    if (policy === "union") {
      if ((left !== undefined && !Array.isArray(left)) || (right !== undefined && !Array.isArray(right))) throw new Error(`invalid rule metadata list: ${field}`);
      const union: unknown[] = [];
      for (const item of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
        if (!union.some(existing => isDeepStrictEqual(existing, item))) union.push(item);
      }
      merged[field] = union;
    } else {
      if ((left !== undefined && typeof left !== "boolean") || (right !== undefined && typeof right !== "boolean")) throw new Error(`invalid rule metadata boolean: ${field}`);
      merged[field] = policy === "any" ? left === true || right === true : (previous === undefined || left === true) && right === true;
    }
  }
  return merged as Required<RuleMetadata>;
}
