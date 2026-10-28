/** The environment-owned Navigator identity capability. */
export interface NavigatorCapability {
  /**
   * Return this environment's configured default User-Agent value as a string.
   * This operation is infallible; a native binding must never throw into source.
   * It must agree with the same environment default used by the Fetch provider.
   */
  userAgent(): string;
}
