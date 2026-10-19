/*---
description: A `this` parameter is erased; the function receives `this` from how it is called.
features: [ts-functions, ts-this-parameter, ts-this]
---*/
interface Account {
  balance: number;
}
function deposit(this: Account, amount: number): number {
  this.balance += amount;
  return this.balance;
}
const account: Account = { balance: 10 };
assert.sameValue(deposit.call(account, 5), 15);
const bound = deposit.bind(account);
assert.sameValue(bound(1), 16);
const method = { balance: 0, deposit };
assert.sameValue(method.deposit(3), 3);
