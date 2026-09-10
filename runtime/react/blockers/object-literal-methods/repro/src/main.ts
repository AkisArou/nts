type Thenable = {
  then(): void;
};

export const completed: Thenable = {
  then() {},
};

type StoredThenable = {
  then: () => void;
};

export const stored: StoredThenable = {
  then: () => {},
};

export function notify(): void {
  completed.then();
}

export function notifyStored(): void {
  stored.then();
}
