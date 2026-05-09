export interface CommandSpec {
  raw: string;
  executable: string | null;
  hasShellMeta: boolean;
}

type TokenSpan = {
  executable: string | null;
  start: number;
  end: number;
};

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function scanFirstToken(raw: string): TokenSpan {
  let index = 0;
  while (index < raw.length && isWhitespace(raw[index]!)) {
    index++;
  }

  const start = index;
  let executable = "";
  let quote: "'" | '"' | null = null;

  while (index < raw.length) {
    const char = raw[index]!;

    if (quote === null) {
      if (isWhitespace(char)) {
        break;
      }
      if (char === "'" || char === '"') {
        quote = char;
        index++;
        continue;
      }
      if (char === "\\") {
        index++;
        if (index < raw.length) {
          executable += raw[index]!;
          index++;
        }
        continue;
      }
      executable += char;
      index++;
      continue;
    }

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        executable += char;
      }
      index++;
      continue;
    }

    if (char === '"') {
      quote = null;
      index++;
      continue;
    }
    if (char === "\\") {
      index++;
      if (index < raw.length) {
        executable += raw[index]!;
        index++;
      }
      continue;
    }
    executable += char;
    index++;
  }

  return {
    executable: executable.length > 0 ? executable : null,
    start,
    end: index,
  };
}

function detectShellMeta(raw: string): boolean {
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;

    if (quote === null) {
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === "\\") {
        index++;
        continue;
      }
      if (char === ";" || char === "|" || char === "&" || char === "`" || char === "<" || char === ">") {
        return true;
      }
      if (char === "$" && (raw[index + 1] === "(" || raw[index + 1] === "{")) {
        return true;
      }
      continue;
    }

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      }
      continue;
    }

    if (char === '"') {
      quote = null;
      continue;
    }
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === "`") {
      return true;
    }
    if (char === "$" && (raw[index + 1] === "(" || raw[index + 1] === "{")) {
      return true;
    }
  }

  return false;
}

export function analyzeCommand(raw: string): CommandSpec {
  return {
    raw,
    executable: scanFirstToken(raw).executable,
    hasShellMeta: detectShellMeta(raw),
  };
}

export function commandExecutable(raw: string): string | null {
  return analyzeCommand(raw).executable;
}

export function commandHasShellMeta(raw: string): boolean {
  return analyzeCommand(raw).hasShellMeta;
}

export function replaceCommandExecutable(raw: string, replacement: string): string {
  const { executable, start, end } = scanFirstToken(raw);
  if (executable === null) {
    return raw;
  }
  return raw.slice(0, start) + replacement + raw.slice(end);
}
