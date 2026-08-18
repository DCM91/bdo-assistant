// Declaraciones de tipos para paquetes ESM-only sin tipos resolubles con moduleResolution: node

declare module 'chalk' {
  export interface ChalkInstance {
    (text: unknown): string;
    bold(text: unknown): string;
    italic(text: unknown): string;
    underline(text: unknown): string;
    yellow(text: unknown): string;
    red(text: unknown): string;
    green(text: unknown): string;
    blue(text: unknown): string;
    cyan(text: unknown): string;
    magenta(text: unknown): string;
    gray(text: unknown): string;
    grey(text: unknown): string;
    white: ChalkInstance;
    black(text: unknown): string;
    bgYellow(text: unknown): string;
    bgRed(text: unknown): string;
    bgGreen(text: unknown): string;
    bgBlue(text: unknown): string;
    bgCyan(text: unknown): string;
    bgMagenta(text: unknown): string;
    bgWhite(text: unknown): string;
  }
  const chalk: ChalkInstance;
  export default chalk;
}

declare module 'ora' {
  export interface Spinner {
    start(text?: string): Spinner;
    stop(): Spinner;
    succeed(text?: string): Spinner;
    fail(text?: string): Spinner;
    warn(text?: string): Spinner;
    info(text?: string): Spinner;
    text: string;
    isSpinning: boolean;
  }
  export interface OraOptions {
    text?: string;
    color?: string;
    spinner?: string;
  }
  function ora(options?: OraOptions | string): Spinner;
  export default ora;
}
