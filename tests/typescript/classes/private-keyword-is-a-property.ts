/*---
description: A `private` member is an ordinary own property at run time, reachable by element access.
features: [ts-class, ts-private-keyword]
---*/
class Account {
  private balance = 50;
  deposit(amount: number): void {
    this.balance += amount;
  }
}
const account = new Account();
account.deposit(25);
assert.sameValue(Object.keys(account).join(","), "balance");
assert.sameValue(account["balance"], 75);
