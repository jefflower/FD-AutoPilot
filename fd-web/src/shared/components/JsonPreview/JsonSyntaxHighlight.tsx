import React, { useMemo } from 'react';

// ── Token types ──────────────────────────────────────────────────────

type TokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'whitespace';

interface Token {
  type: TokenType;
  value: string;
}

// ── Color mapping (Tailwind classes) ─────────────────────────────────

const TOKEN_COLOR_MAP: Record<TokenType, string> = {
  key: 'text-sky-400',
  string: 'text-emerald-400',
  number: 'text-amber-400',
  boolean: 'text-purple-400',
  null: 'text-red-400/70',
  punctuation: 'text-slate-500',
  whitespace: '',
};

// ── tryFormatJson ────────────────────────────────────────────────────

/**
 * Attempt to parse and pretty-print a JSON string.
 * Returns the original string unchanged if parsing fails.
 */
export function tryFormatJson(str: string): string {
  try {
    const parsed = JSON.parse(str);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
}

// ── tokenizeJson ─────────────────────────────────────────────────────

/**
 * Tokenize a formatted JSON string into an array of typed tokens.
 * The tokenizer walks character-by-character and identifies keys,
 * string values, numbers, booleans, null literals, punctuation and whitespace.
 */
export function tokenizeJson(formatted: string): Token[] {
  const tokens: Token[] = [];
  const len = formatted.length;
  let i = 0;

  // Track whether the *next* string we encounter is a key or a value.
  // In JSON a string is a key when it comes right after `{` or `,` (ignoring whitespace).
  // We use a simple heuristic: after reading a string, if the next non-whitespace char is `:`, it was a key.
  // So we collect strings first as 'string' then retroactively fix up.

  while (i < len) {
    const ch = formatted[i];

    // ── Whitespace (including newlines) ──
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      let ws = ch;
      i++;
      while (i < len && (formatted[i] === ' ' || formatted[i] === '\t' || formatted[i] === '\n' || formatted[i] === '\r')) {
        ws += formatted[i];
        i++;
      }
      tokens.push({ type: 'whitespace', value: ws });
      continue;
    }

    // ── Strings ──
    if (ch === '"') {
      let str = '"';
      i++;
      while (i < len) {
        const c = formatted[i];
        str += c;
        i++;
        if (c === '\\' && i < len) {
          str += formatted[i];
          i++;
        } else if (c === '"') {
          break;
        }
      }

      // Look ahead: if next non-whitespace is ':', this string is a key
      let lookahead = i;
      while (lookahead < len && (formatted[lookahead] === ' ' || formatted[lookahead] === '\t')) {
        lookahead++;
      }
      const isKey = lookahead < len && formatted[lookahead] === ':';

      tokens.push({ type: isKey ? 'key' : 'string', value: str });
      continue;
    }

    // ── Numbers (including negative) ──
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let num = ch;
      i++;
      while (i < len && /[0-9.eE+\-]/.test(formatted[i])) {
        num += formatted[i];
        i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // ── Boolean / null literals ──
    if (ch === 't' && formatted.slice(i, i + 4) === 'true') {
      tokens.push({ type: 'boolean', value: 'true' });
      i += 4;
      continue;
    }
    if (ch === 'f' && formatted.slice(i, i + 5) === 'false') {
      tokens.push({ type: 'boolean', value: 'false' });
      i += 5;
      continue;
    }
    if (ch === 'n' && formatted.slice(i, i + 4) === 'null') {
      tokens.push({ type: 'null', value: 'null' });
      i += 4;
      continue;
    }

    // ── Punctuation ( { } [ ] : , ) ──
    tokens.push({ type: 'punctuation', value: ch });
    i++;
  }

  return tokens;
}

// ── Split tokens into lines ──────────────────────────────────────────

interface LineTokens {
  tokens: Token[];
}

function splitTokensIntoLines(tokens: Token[]): LineTokens[] {
  const lines: LineTokens[] = [{ tokens: [] }];

  for (const token of tokens) {
    if (token.type === 'whitespace' && token.value.includes('\n')) {
      // Split whitespace token by newlines
      const parts = token.value.split('\n');
      for (let pi = 0; pi < parts.length; pi++) {
        if (pi > 0) {
          lines.push({ tokens: [] });
        }
        const part = parts[pi];
        if (part.length > 0) {
          lines[lines.length - 1].tokens.push({ type: 'whitespace', value: part });
        }
      }
    } else {
      lines[lines.length - 1].tokens.push(token);
    }
  }

  return lines;
}

// ── Highlight search matches within text ─────────────────────────────

function highlightText(text: string, searchTerm: string): React.ReactNode {
  if (!searchTerm) return text;

  const lowerText = text.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = lowerText.indexOf(lowerSearch, lastIndex);

  while (matchIndex !== -1) {
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }
    parts.push(
      <mark
        key={`${matchIndex}-${text.slice(matchIndex, matchIndex + searchTerm.length)}`}
        className="bg-amber-500/30 text-amber-200 rounded-sm"
      >
        {text.slice(matchIndex, matchIndex + searchTerm.length)}
      </mark>
    );
    lastIndex = matchIndex + searchTerm.length;
    matchIndex = lowerText.indexOf(lowerSearch, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

// ── Component ────────────────────────────────────────────────────────

interface JsonSyntaxHighlightProps {
  json: string;
  searchTerm?: string;
}

const JsonSyntaxHighlight: React.FC<JsonSyntaxHighlightProps> = ({ json, searchTerm = '' }) => {
  const formatted = useMemo(() => tryFormatJson(json), [json]);

  const tokenLines = useMemo(() => {
    const tokens = tokenizeJson(formatted);
    return splitTokensIntoLines(tokens);
  }, [formatted]);

  const lineNumberWidth = useMemo(() => {
    const digits = String(tokenLines.length).length;
    return Math.max(digits, 2);
  }, [tokenLines.length]);

  return (
    <div className="font-mono text-xs leading-5 whitespace-pre">
      {tokenLines.map((line, lineIdx) => (
        <div key={lineIdx} className="flex hover:bg-slate-800/50">
          {/* Line number */}
          <span
            className="inline-block text-right text-slate-600 select-none shrink-0 pr-4 pl-2"
            style={{ width: `${lineNumberWidth + 3}ch` }}
          >
            {lineIdx + 1}
          </span>
          {/* Line content */}
          <span className="flex-1 min-w-0">
            {line.tokens.map((token, tokenIdx) => {
              if (token.type === 'whitespace') {
                return (
                  <span key={tokenIdx}>{token.value}</span>
                );
              }
              const colorClass = TOKEN_COLOR_MAP[token.type];
              return (
                <span key={tokenIdx} className={colorClass}>
                  {searchTerm ? highlightText(token.value, searchTerm) : token.value}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
};

export default React.memo(JsonSyntaxHighlight);
