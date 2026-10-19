// k6 provides `console` at runtime but @types/k6 leaves it to lib.dom, which
// a k6 script shouldn't include. This is the part k6 implements.
declare const console: {
  log(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  debug(...args: unknown[]): void
}
