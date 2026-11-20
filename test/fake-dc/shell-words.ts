/** Splits a POSIX shell command line into words, supporting single quotes, double quotes and backslashes. */
export function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error('Unterminated single quote');
      word += line.slice(i + 1, end);
      i = end;
      inWord = true;
    } else if (c === '"') {
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) i++;
        word += line[i]!;
        i++;
      }
      inWord = true;
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[++i]!;
      inWord = true;
    } else if (c === ' ' || c === '\t') {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else if (';&|<>`$()'.includes(c)) {
      throw new Error(`Unexpected shell metacharacter ${c}`);
    } else {
      word += c;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  return words;
}
