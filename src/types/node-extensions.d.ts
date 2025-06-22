declare namespace NodeJS {
  interface Process {
    _rawDebug?(...args: unknown[]): void;
  }
}
