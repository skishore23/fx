/**
 * Declarative Argument DSL for Fx Framework
 * Replaces fragile regex with composable parsers
 */

import { z } from 'zod';

// ---------- Parser Types ----------

export type Parser<T> = (s: string) => T | null;

export interface ParseResult<T> {
  readonly value: T;
  readonly remaining: string;
}

export type ParserWithRemaining<T> = (s: string) => ParseResult<T> | null;

// ---------- Basic Parsers ----------

/**
 * Token parser - matches a regex pattern
 */
export const token = (re: RegExp): Parser<string> => (s: string) => {
  const match = re.exec(s.trim());
  return match ? match[0] : null;
};

/**
 * Quoted string parser - handles both single and double quotes
 */
export const quoted = (): Parser<string> => (s: string): string | null => {
  const trimmed = s.trim();
  const singleQuoteMatch = /^'([^']*)'/.exec(trimmed);
  if (singleQuoteMatch && singleQuoteMatch[1] !== undefined) return singleQuoteMatch[1];
  
  const doubleQuoteMatch = /^"([^"]*)"/.exec(trimmed);
  if (doubleQuoteMatch && doubleQuoteMatch[1] !== undefined) return doubleQuoteMatch[1];
  
  return null;
};

/**
 * File path parser - handles paths with spaces and extensions
 */
export const filePath = (): Parser<string> => (s: string): string | null => {
  // Try quoted first
  const quotedResult = quoted()(s);
  if (quotedResult !== null) return quotedResult;
  
  // Then try unquoted path
  const pathMatch = /^([^\s]+(?:\s+[^\s]+)*)/.exec(s.trim());
  return pathMatch && pathMatch[1] !== undefined ? pathMatch[1] : null;
};

/**
 * Number parser
 */
export const number = (): Parser<number> => (s: string) => {
  const match = /^-?\d+(?:\.\d+)?/.exec(s.trim());
  return match ? parseFloat(match[0]) : null;
};

/**
 * Boolean parser
 */
export const boolean = (): Parser<boolean> => (s: string) => {
  const trimmed = s.trim().toLowerCase();
  if (trimmed === 'true' || trimmed === 'yes' || trimmed === '1') return true;
  if (trimmed === 'false' || trimmed === 'no' || trimmed === '0') return false;
  return null;
};

/**
 * Word parser - matches a single word
 */
export const word = (): Parser<string> => (s: string) => {
  const match = /^\w+/.exec(s.trim());
  return match ? match[0] : null;
};

// ---------- Combinator Parsers ----------

/**
 * First of parser - tries parsers in order
 */
export const firstOf = <T>(...parsers: Parser<T>[]): Parser<T> => (s: string) => {
  for (const parser of parsers) {
    const result = parser(s);
    if (result !== null) return result;
  }
  return null;
};

/**
 * Sequence parser - matches multiple parsers in sequence
 */
export const sequence = <T extends readonly unknown[]>(
  ...parsers: { [K in keyof T]: Parser<T[K]> }
): Parser<T> => (s: string) => {
  let remaining = s.trim();
  const results: unknown[] = [];
  
  for (const parser of parsers) {
    const result = parser(remaining);
    if (result === null) return null;
    
    results.push(result);
    // Remove parsed part from remaining string
    const parsedLength = remaining.length - (remaining.replace(/^\s*/, '').length - remaining.replace(/^\s*/, '').indexOf(String(result)));
    remaining = remaining.slice(parsedLength).trim();
  }
  
  return results as unknown as T;
};

/**
 * Optional parser - matches parser or returns null
 */
export const optional = <T>(parser: Parser<T>): Parser<T | null> => (s: string) => {
  const result = parser(s);
  return result !== null ? result : null;
};

/**
 * Many parser - matches zero or more occurrences
 */
export const many = <T>(parser: Parser<T>): Parser<T[]> => (s: string) => {
  const results: T[] = [];
  let remaining = s.trim();
  
  while (remaining.length > 0) {
    const result = parser(remaining);
    if (result === null) break;
    
    results.push(result);
    // Simple heuristic to advance the string
    const resultStr = String(result);
    const index = remaining.indexOf(resultStr);
    if (index === -1) break;
    remaining = remaining.slice(index + resultStr.length).trim();
  }
  
  return results;
};

/**
 * Separated by parser - matches items separated by a delimiter
 */
export const separatedBy = <T>(
  itemParser: Parser<T>,
  delimiter: string
): Parser<T[]> => (s: string) => {
  const items: T[] = [];
  let remaining = s.trim();
  
  while (remaining.length > 0) {
    const item = itemParser(remaining);
    if (item === null) break;
    
    items.push(item);
    
    // Find and skip delimiter
    const itemStr = String(item);
    const itemIndex = remaining.indexOf(itemStr);
    if (itemIndex === -1) break;
    
    remaining = remaining.slice(itemIndex + itemStr.length).trim();
    
    if (remaining.startsWith(delimiter)) {
      remaining = remaining.slice(delimiter.length).trim();
    } else {
      break;
    }
  }
  
  return items.length > 0 ? items : null;
};

// ---------- Tool-Specific Argument Parsers ----------

/**
 * Read file arguments
 */
export const readFileArgs = (msg: string): { filePath: string } | null => {
  const filePathResult = firstOf(quoted(), filePath())(msg);
  return filePathResult ? { filePath: filePathResult } : null;
};

/**
 * Write file arguments
 */
export const writeFileArgs = (msg: string): { filePath: string; content: string } | null => {
  const pathResult = firstOf(quoted(), filePath())(msg);
  if (!pathResult) return null;
  
  // Extract content after the path
  const pathIndex = msg.indexOf(pathResult);
  if (pathIndex === -1) return null;
  
  const afterPath = msg.slice(pathIndex + pathResult.length).trim();
  const contentMatch = /(?:with\s+content|content\s+is|saying|containing)\s+(.+)/i.exec(afterPath);
  
  if (contentMatch && contentMatch[1]) {
    const content = contentMatch[1].trim();
    return { filePath: pathResult, content };
  }
  
  return null;
};

/**
 * Search arguments
 */
export const searchArgs = (msg: string): { query: string; maxResults?: number } | null => {
  const searchMatch = /(?:search|find|look\s+for|seek|query)\s+(?:for\s+)?([^;\n]+)/i.exec(msg);
  if (!searchMatch || !searchMatch[1]) return null;
  
  const query = searchMatch[1].trim();
  const maxResultsMatch = /(?:limit|max|top)\s+(\d+)/i.exec(query);
  
  let maxResults: number | undefined;
  if (maxResultsMatch && maxResultsMatch[1]) {
    maxResults = parseInt(maxResultsMatch[1], 10);
  }
  
  return { query, maxResults };
};

/**
 * API call arguments
 */
export const apiCallArgs = (msg: string): { url: string; method?: string; data?: string } | null => {
  const urlMatch = /(https?:\/\/[^\s]+)/.exec(msg);
  if (!urlMatch || !urlMatch[1]) return null;
  
  const url = urlMatch[1];
  const methodMatch = /\b(get|post|put|delete|patch)\b/i.exec(msg);
  const method = methodMatch && methodMatch[1] ? methodMatch[1].toUpperCase() : 'GET';
  
  const dataMatch = /(?:with\s+data|data\s+is|body\s+is)\s+(.+)/i.exec(msg);
  const data = dataMatch && dataMatch[1] ? dataMatch[1].trim() : undefined;
  
  return { url, method, data };
};

/**
 * Command execution arguments
 */
export const commandArgs = (msg: string): { command: string; workingDirectory?: string } | null => {
  const commandMatch = /(?:run|execute|launch|start)\s+(?:command\s+)?(.+)/i.exec(msg);
  if (!commandMatch || !commandMatch[1]) return null;
  
  const command = commandMatch[1].trim();
  const dirMatch = /(?:in|from|at)\s+(?:directory\s+)?([^\s]+)/i.exec(command);
  
  let workingDirectory: string | undefined;
  if (dirMatch && dirMatch[1]) {
    workingDirectory = dirMatch[1];
  }
  
  return { command, workingDirectory };
};

// ---------- Argument Specification Registry ----------

export const argSpec = {
  read_file: readFileArgs,
  write_file: writeFileArgs,
  search: searchArgs,
  api_call: apiCallArgs,
  execute_command: commandArgs
} as const;

// ---------- Validation with Zod ----------

/**
 * Validate parsed arguments with Zod schema
 */
export function validateArgs<T>(
  args: unknown,
  schema: z.ZodType<T>
): { success: true; data: T } | { success: false; error: string } {
  try {
    const data = schema.parse(args);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors.map(e => e.message).join(', ') };
    }
    return { success: false, error: 'Unknown validation error' };
  }
}

// ---------- Multi-tool Sentence Parser ----------

/**
 * Split multi-tool sentences safely
 */
export function splitMultiToolSentence(msg: string): string[] {
  // Split on common conjunctions and separators
  const separators = [/\s+and\s+/i, /\s+then\s+/i, /;\s*/, /\s+after\s+that\s+/i];
  
  let sentences = [msg];
  
  for (const separator of separators) {
    const newSentences: string[] = [];
    for (const sentence of sentences) {
      newSentences.push(...sentence.split(separator).map(s => s.trim()).filter(s => s.length > 0));
    }
    sentences = newSentences;
  }
  
  return sentences;
}

// ---------- Parser Utilities ----------

/**
 * Create a parser that consumes whitespace
 */
export const whitespace = (): Parser<string> => (s: string) => {
  const match = /^\s+/.exec(s);
  return match ? match[0] : null;
};

/**
 * Create a parser that matches end of string
 */
export const eof = (): Parser<null> => (s: string) => {
  return s.trim().length === 0 ? null : null;
};

/**
 * Create a parser that matches a literal string
 */
export const literal = (str: string): Parser<string> => (s: string) => {
  const trimmed = s.trim();
  return trimmed.startsWith(str) ? str : null;
};

/**
 * Create a parser that matches case-insensitive literal
 */
export const literalCI = (str: string): Parser<string> => (s: string) => {
  const trimmed = s.trim();
  return trimmed.toLowerCase().startsWith(str.toLowerCase()) ? str : null;
};
