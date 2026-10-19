/*---
description: A member a namespace does not export is visible inside it only.
features: [ts-namespace]
---*/
namespace Vault {
  const secret = 5;
  export function reveal(): number {
    return secret;
  }
}
assert.sameValue(Vault.reveal(), 5);
assert.sameValue("secret" in Vault, false);
