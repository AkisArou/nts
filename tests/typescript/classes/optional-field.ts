/*---
description: An optional field without an initialiser is still defined, as undefined, under define semantics.
features: [ts-class, ts-class-fields, ts-optional-properties]
---*/
class Profile {
  nickname?: string;
  age = 30;
}
const profile = new Profile();
assert.sameValue(profile.nickname, undefined);
assert.sameValue("nickname" in profile, true);
assert.sameValue(Object.keys(profile).join(","), "nickname,age");
