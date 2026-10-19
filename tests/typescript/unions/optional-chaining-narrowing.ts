/*---
description: An optional chain that reaches a defined value narrows every link before it.
features: [ts-unions, ts-narrowing, ts-optional-chaining]
---*/
type Profile = { address?: { city?: string } };
function city(profile: Profile | undefined): string {
  if (profile?.address?.city !== undefined) return profile.address.city.toUpperCase();
  return "?";
}
assert.sameValue(city({ address: { city: "rome" } }), "ROME");
assert.sameValue(city({ address: {} }), "?");
assert.sameValue(city({}), "?");
assert.sameValue(city(undefined), "?");
