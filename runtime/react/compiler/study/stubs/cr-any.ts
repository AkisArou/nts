export function c(size: number): any[] { return new Array(size); }

// The typed cache nts-react writes: a record the component declares.
export function cacheOf<T>(shape: { create: () => T; clone: (cache: T) => T }): T { return shape.create(); }
