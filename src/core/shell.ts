/** Quotes a string so a POSIX shell treats it as a single literal argument. */
export function shellQuote(arg: string): string {
  if (arg.includes('\0')) {
    throw new Error('Arguments cannot contain NUL characters');
  }
  if (arg !== '' && /^[A-Za-z0-9_\-.,/=@%+:]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** Joins an argument vector into a shell command line with every argument quoted. */
export function shellJoin(argv: readonly string[]): string {
  return argv.map(shellQuote).join(' ');
}
