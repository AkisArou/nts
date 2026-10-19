/*---
description: Two dotted namespaces sharing a prefix merge into one outer object.
features: [ts-namespace, ts-declaration-merging]
---*/
namespace App.Models {
  export const user = "user";
}
namespace App.Views {
  export const page = "page";
}
assert.sameValue(App.Models.user, "user");
assert.sameValue(App.Views.page, "page");
assert.sameValue(Object.keys(App).length, 2);
