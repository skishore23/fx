/**
 * Tool Router System for Fx Framework
 * Implements pattern gates + tiny classifier for deterministic tool selection
 * Built using functional composition and category theory principles
 */

import { BaseContext, Step } from './types';
import { sequence, parallel, when, fromFunction } from './composition';
import { z } from 'zod';

// ---------- Router Types ----------

export type Tool = 'read_file' | 'write_file' | 'api_call' | 'search' | 'execute_command';

export interface RouterSignal {
  readonly text: string;
  readonly locale?: string;
}

export interface RouterCandidate {
  readonly tool: Tool;
  readonly score: number;
  readonly reason: string;
}

export interface RouterOut {
  readonly candidates: RouterCandidate[];
}

export interface ToolRouter {
  route(sig: RouterSignal, gated: Tool[]): Promise<RouterOut>;
}

// ---------- Router Pure Functions (Morphisms) ----------

/**
 * Pure function to apply pattern gate
 * Category theory: This is a morphism (string, PatternRule[]) -> Tool[]
 */
export const patternGate = (text: string, rules: PatternRule[]): Tool[] => {
  const matchedTools: Tool[] = [];
  
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      matchedTools.push(rule.tool);
    }
  }
  
  return [...new Set(matchedTools)]; // Remove duplicates
};

/**
 * Pure function to classify text using simple heuristics
 * Category theory: This is a morphism string -> RouterCandidate[]
 */
export const classifyText = (text: string): RouterCandidate[] => {
  const candidates: RouterCandidate[] = [];
  const lowerText = text.toLowerCase();
  
  // Simple keyword-based classification
  const keywords = {
    'read_file': ['read', 'view', 'show', 'display', 'get', 'fetch', 'file', 'document'],
    'write_file': ['write', 'create', 'save', 'update', 'edit', 'file', 'document'],
    'search': ['search', 'find', 'look', 'seek', 'query', 'google', 'bing'],
    'api_call': ['call', 'request', 'fetch', 'api', 'endpoint', 'service', 'http'],
    'execute_command': ['run', 'execute', 'launch', 'start', 'command', 'shell', 'bash']
  };
  
  for (const [tool, toolKeywords] of Object.entries(keywords)) {
    const score = toolKeywords.reduce((acc, keyword) => {
      return acc + (lowerText.includes(keyword) ? 1 : 0);
    }, 0) / toolKeywords.length;
    
    if (score > 0) {
      candidates.push({
        tool: tool as Tool,
        score,
        reason: 'classifier'
      });
    }
  }
  
  return candidates.sort((a, b) => b.score - a.score);
};

/**
 * Pure function to merge router results
 * Category theory: This is a monoidal operation on RouterOut
 */
export const mergeRouterResults = (pattern: Tool[], classifier: RouterCandidate[]): RouterOut => {
  const candidates: RouterCandidate[] = [];
  
  // Add pattern matches with high confidence
  for (const tool of pattern) {
    candidates.push({
      tool,
      score: 1.0,
      reason: 'pattern'
    });
  }
  
  // Add classifier results if no pattern matches
  if (pattern.length === 0) {
    candidates.push(...classifier);
  }
  
  return { candidates };
};

// ---------- Router Steps (Composed from Pure Functions) ----------

/**
 * Step to apply pattern gate
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const patternGateStep = <T extends BaseContext>(text: string): Step<T> => {
  return fromFunction('patternGate', async (state: T) => {
    const gatedTools = patternGate(text, [...PATTERN_RULES]);
    return {
      ...state,
      gatedTools
    } as T;
  });
};

/**
 * Step to classify text
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const classifyTextStep = <T extends BaseContext>(text: string): Step<T> => {
  return fromFunction('classifyText', async (state: T) => {
    const candidates = classifyText(text);
    return {
      ...state,
      routerCandidates: candidates
    } as T;
  });
};

/**
 * Composed routing step using existing composition operators
 * Category theory: This composes pattern gate and classifier using parallel
 */
export const routeStep = <T extends BaseContext>(signal: RouterSignal): Step<T> => {
  return parallel([
    patternGateStep(signal.text),
    classifyTextStep(signal.text)
  ], (results, originalState) => {
    const gatedTools = results[0]?.gatedTools as Tool[] || [];
    const routerCandidates = results[1]?.routerCandidates as RouterCandidate[] || [];
    
    const routerOut = mergeRouterResults(gatedTools, routerCandidates);
    
    return {
      ...originalState,
      routerResult: routerOut
    } as T;
  });
};

// ---------- Pattern Gate System ----------

interface PatternRule {
  readonly pattern: RegExp;
  readonly tool: Tool;
  readonly confidence: number;
}

const PATTERN_RULES: readonly PatternRule[] = [
  // File operations
  { pattern: /\b(read|view|show|display|get|fetch)\s+(?:the\s+)?(?:contents?\s+of\s+)?(?:file|document)\b/i, tool: 'read_file', confidence: 0.9 },
  { pattern: /\b(write|create|save|update|edit)\s+(?:to\s+)?(?:file|document)\b/i, tool: 'write_file', confidence: 0.9 },
  { pattern: /\b(open|load)\s+(?:the\s+)?(?:file|document)\b/i, tool: 'read_file', confidence: 0.8 },
  
  // Search operations
  { pattern: /\b(search|find|look\s+for|seek|query)\b/i, tool: 'search', confidence: 0.8 },
  { pattern: /\b(google|bing|duckduckgo)\b/i, tool: 'search', confidence: 0.7 },
  
  // API operations
  { pattern: /\b(call|request|fetch|get|post|put|delete)\s+(?:api|endpoint|service)\b/i, tool: 'api_call', confidence: 0.8 },
  { pattern: /\b(http|https|rest|graphql)\b/i, tool: 'api_call', confidence: 0.7 },
  
  // Command execution
  { pattern: /\b(run|execute|launch|start|command|shell|terminal)\b/i, tool: 'execute_command', confidence: 0.8 },
  { pattern: /\b(ls|cd|mkdir|rm|cp|mv|grep|cat|echo)\b/i, tool: 'execute_command', confidence: 0.9 },
] as const;


// ---------- Tiny Classifier System ----------

interface ClassifierFeatures {
  readonly ngrams: string[];
  readonly hasQuotes: boolean;
  readonly hasFileExtension: boolean;
  readonly hasUrl: boolean;
  readonly wordCount: number;
  readonly hasQuestionMark: boolean;
}

interface ClassifierWeights {
  readonly [tool: string]: {
    readonly [feature: string]: number;
  };
}

// Simple n-gram feature extraction
function extractNgrams(text: string, n: number = 2): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const ngrams: string[] = [];
  
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '));
  }
  
  return ngrams;
}

/**
 * Extract features from text for classification
 */
function featurize(text: string): ClassifierFeatures {
  return {
    ngrams: extractNgrams(text, 2),
    hasQuotes: /["']/.test(text),
    hasFileExtension: /\.[a-zA-Z0-9]+/.test(text),
    hasUrl: /https?:\/\//.test(text),
    wordCount: text.split(/\s+/).length,
    hasQuestionMark: /\?/.test(text)
  };
}

// Simple linear classifier weights (would be trained from ledger data)
const CLASSIFIER_WEIGHTS: ClassifierWeights = {
  read_file: {
    'read file': 0.8,
    'view file': 0.7,
    'show file': 0.6,
    'hasFileExtension': 0.5,
    'hasQuotes': 0.3
  },
  write_file: {
    'write file': 0.8,
    'create file': 0.7,
    'save file': 0.6,
    'hasFileExtension': 0.4
  },
  search: {
    'search for': 0.8,
    'find information': 0.7,
    'look for': 0.6,
    'hasQuestionMark': 0.4
  },
  api_call: {
    'call api': 0.8,
    'http request': 0.7,
    'hasUrl': 0.6,
    'fetch data': 0.5
  },
  execute_command: {
    'run command': 0.8,
    'execute command': 0.7,
    'shell command': 0.6
  }
};

/**
 * Score tools using simple linear classifier
 */
function modelScore(features: ClassifierFeatures): Array<{ tool: Tool; score: number }> {
  const scores: Array<{ tool: Tool; score: number }> = [];
  
  for (const [toolName, weights] of Object.entries(CLASSIFIER_WEIGHTS)) {
    let score = 0;
    
    // N-gram features
    for (const ngram of features.ngrams) {
      if (weights[ngram]) {
        score += weights[ngram];
      }
    }
    
    // Boolean features
    if (features.hasQuotes && weights.hasQuotes) score += weights.hasQuotes;
    if (features.hasFileExtension && weights.hasFileExtension) score += weights.hasFileExtension;
    if (features.hasUrl && weights.hasUrl) score += weights.hasUrl;
    if (features.hasQuestionMark && weights.hasQuestionMark) score += weights.hasQuestionMark;
    
    scores.push({ tool: toolName as Tool, score });
  }
  
  return scores.sort((a, b) => b.score - a.score);
}

// ---------- Router Implementation ----------

/**
 * Main router implementation
 */
export const router: ToolRouter = {
  async route({ text }, gated): Promise<RouterOut> {
    // Pattern gate takes precedence
    if (gated.length > 0) {
      return {
        candidates: gated.map(tool => ({
          tool,
          score: 1,
          reason: 'pattern'
        }))
      };
    }
    
    // Fall back to tiny classifier
    const features = featurize(text);
    const scored = modelScore(features);
    
    return {
      candidates: scored
        .slice(0, 2) // Top 2 candidates
        .map(({ tool, score }) => ({
          tool,
          score: Math.max(0, Math.min(1, score)), // Clamp to [0, 1]
          reason: 'classifier'
        }))
    };
  }
};

// ---------- Router Utilities ----------

/**
 * Create a custom router with specific pattern rules
 */
export function createRouter(customRules: PatternRule[]): ToolRouter {
  const allRules = [...PATTERN_RULES, ...customRules];
  
  return {
    async route({ text }, gated): Promise<RouterOut> {
      // Custom pattern gate
      if (gated.length > 0) {
        return {
          candidates: gated.map(tool => ({
            tool,
            score: 1,
            reason: 'pattern'
          }))
        };
      }
      
      // Check custom patterns
      const matchedTools: Tool[] = [];
      for (const rule of allRules) {
        if (rule.pattern.test(text)) {
          matchedTools.push(rule.tool);
        }
      }
      
      if (matchedTools.length > 0) {
        return {
          candidates: [...new Set(matchedTools)].map(tool => ({
            tool,
            score: 0.9,
            reason: 'custom-pattern'
          }))
        };
      }
      
      // Fall back to classifier
      const features = featurize(text);
      const scored = modelScore(features);
      
      return {
        candidates: scored
          .slice(0, 2)
          .map(({ tool, score }) => ({
            tool,
            score: Math.max(0, Math.min(1, score)),
            reason: 'classifier'
          }))
      };
    }
  };
}

/**
 * Validate router output
 */
export function validateRouterOut(output: RouterOut): boolean {
  return (
    Array.isArray(output.candidates) &&
    output.candidates.every(candidate =>
      typeof candidate.tool === 'string' &&
      typeof candidate.score === 'number' &&
      typeof candidate.reason === 'string' &&
      candidate.score >= 0 &&
      candidate.score <= 1
    )
  );
}

/**
 * Get top candidate from router output
 */
export function getTopCandidate(output: RouterOut): RouterCandidate | null {
  if (output.candidates.length === 0) {
    return null;
  }
  
  return output.candidates.reduce((top, current) =>
    current.score > top.score ? current : top
  );
}
