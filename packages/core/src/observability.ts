/**
 * Observability System for Fx Framework
 * Provides decision records, confusion tracking, and replay capabilities
 * Built using functional composition and category theory principles
 */

import { BaseContext, Step } from './types';
import { Tool } from './router';
import { RouterCandidate } from './router';

// ---------- Observability Types ----------

export interface DecisionRecord {
  readonly id: string;
  readonly timestamp: Date;
  readonly input: string;
  readonly patternsMatched: string[];
  readonly routerCandidates: RouterCandidate[];
  readonly chosen: Tool[];
  readonly args: Record<string, unknown>;
  readonly outcome: 'ok' | 'fail';
  readonly latMs: number;
  readonly error?: string;
  readonly context?: Record<string, unknown>;
}

export interface ConfusionMatrix {
  readonly patternVsClassifier: Map<string, number>;
  readonly toolAccuracy: Map<Tool, { correct: number; total: number }>;
  readonly commonFailures: Array<{ pattern: string; count: number }>;
  readonly performanceMetrics: PerformanceMetrics;
}

export interface PerformanceMetrics {
  readonly avgLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly successRate: number;
  readonly errorRate: number;
  readonly throughputPerMinute: number;
}

export interface ReplayContext {
  readonly decisionId: string;
  readonly originalInput: string;
  readonly originalOutcome: 'ok' | 'fail';
  readonly replayTimestamp: Date;
}

// ---------- Decision Recorder ----------

export class DecisionRecorder {
  private records: DecisionRecord[] = [];
  private readonly maxRecords: number;

  constructor(maxRecords: number = 10000) {
    this.maxRecords = maxRecords;
  }

  /**
   * Record a decision
   */
  record(record: Omit<DecisionRecord, 'id' | 'timestamp'>): string {
    const id = this.generateId();
    const timestamp = new Date();
    
    const fullRecord: DecisionRecord = {
      id,
      timestamp,
      ...record
    };

    this.records.push(fullRecord);
    
    // Maintain max records limit
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    return id;
  }

  /**
   * Get decision record by ID
   */
  getRecord(id: string): DecisionRecord | undefined {
    return this.records.find(record => record.id === id);
  }

  /**
   * Get recent records
   */
  getRecentRecords(limit: number = 100): DecisionRecord[] {
    return this.records.slice(-limit);
  }

  /**
   * Get records by time range
   */
  getRecordsByTimeRange(start: Date, end: Date): DecisionRecord[] {
    return this.records.filter(record => 
      record.timestamp >= start && record.timestamp <= end
    );
  }

  /**
   * Get records by outcome
   */
  getRecordsByOutcome(outcome: 'ok' | 'fail'): DecisionRecord[] {
    return this.records.filter(record => record.outcome === outcome);
  }

  /**
   * Get all records
   */
  getAllRecords(): DecisionRecord[] {
    return [...this.records];
  }

  /**
   * Clear all records
   */
  clear(): void {
    this.records = [];
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `dec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ---------- Confusion Tracking Functions (Pure Functions) ----------

/**
 * Pure function to analyze pattern vs classifier agreement
 * Category theory: This is a morphism DecisionRecord -> ConfusionData
 */
export const analyzePatternVsClassifier = (record: DecisionRecord): Map<string, number> => {
  const hasPatternMatch = record.patternsMatched.length > 0;
  const hasClassifierMatch = record.routerCandidates.some(c => c.reason === 'classifier');
  
  const result = new Map<string, number>();
  
  if (hasPatternMatch && hasClassifierMatch) {
    result.set('pattern_and_classifier', 1);
  } else if (hasPatternMatch) {
    result.set('pattern_only', 1);
  } else if (hasClassifierMatch) {
    result.set('classifier_only', 1);
  }
  
  return result;
};

/**
 * Pure function to analyze tool accuracy
 * Category theory: This is a morphism DecisionRecord -> ToolAccuracyData
 */
export const analyzeToolAccuracy = (record: DecisionRecord): Map<Tool, { correct: number; total: number }> => {
  const result = new Map<Tool, { correct: number; total: number }>();
  
  for (const tool of record.chosen) {
    const isCorrect = record.outcome === 'ok';
    result.set(tool, {
      correct: isCorrect ? 1 : 0,
      total: 1
    });
  }
  
  return result;
};

/**
 * Pure function to categorize errors
 * Category theory: This is a morphism string -> string
 */
export const categorizeError = (error: string): string => {
  const lowerError = error.toLowerCase();
  
  if (lowerError.includes('timeout')) return 'timeout';
  if (lowerError.includes('permission')) return 'permission';
  if (lowerError.includes('validation')) return 'validation';
  if (lowerError.includes('network')) return 'network';
  if (lowerError.includes('quota')) return 'quota';
  if (lowerError.includes('circuit breaker')) return 'circuit_breaker';
  
  return 'other';
};

/**
 * Pure function to analyze common failures
 * Category theory: This is a morphism DecisionRecord -> FailureData
 */
export const analyzeCommonFailures = (record: DecisionRecord): Map<string, number> => {
  const result = new Map<string, number>();
  
  if (record.outcome === 'fail' && record.error) {
    const errorKey = categorizeError(record.error);
    result.set(errorKey, 1);
  }
  
  return result;
};

/**
 * Pure function to merge confusion data
 * Category theory: This is a monoidal operation on confusion data
 */
export const mergeConfusionData = (
  existing: Map<string, number>,
  newData: Map<string, number>
): Map<string, number> => {
  const result = new Map(existing);
  
  for (const [key, value] of newData) {
    result.set(key, (result.get(key) || 0) + value);
  }
  
  return result;
};

/**
 * Pure function to merge tool accuracy data
 * Category theory: This is a monoidal operation on tool accuracy data
 */
export const mergeToolAccuracy = (
  existing: Map<Tool, { correct: number; total: number }>,
  newData: Map<Tool, { correct: number; total: number }>
): Map<Tool, { correct: number; total: number }> => {
  const result = new Map(existing);
  
  for (const [tool, stats] of newData) {
    const existingStats = result.get(tool) || { correct: 0, total: 0 };
    result.set(tool, {
      correct: existingStats.correct + stats.correct,
      total: existingStats.total + stats.total
    });
  }
  
  return result;
};

/**
 * Pure function to calculate performance metrics
 * Category theory: This is a morphism DecisionRecord[] -> PerformanceMetrics
 */
export const calculatePerformanceMetrics = (records: DecisionRecord[]): PerformanceMetrics => {
  if (records.length === 0) {
    return {
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      successRate: 0,
      errorRate: 0,
      throughputPerMinute: 0
    };
  }

  const latencies = records.map(r => r.latMs).sort((a, b) => a - b);
  const successCount = records.filter(r => r.outcome === 'ok').length;
  const errorCount = records.filter(r => r.outcome === 'fail').length;
  
  const avgLatencyMs = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
  const p95LatencyMs = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99LatencyMs = latencies[Math.floor(latencies.length * 0.99)] || 0;
  
  const successRate = successCount / records.length;
  const errorRate = errorCount / records.length;
  
  // Calculate throughput (records per minute)
  const timeSpan = records.length > 1 
    ? (records[records.length - 1]?.timestamp.getTime() || 0) - (records[0]?.timestamp.getTime() || 0)
    : 1;
  const throughputPerMinute = (records.length / timeSpan) * 60000;

  return {
    avgLatencyMs,
    p95LatencyMs,
    p99LatencyMs,
    successRate,
    errorRate,
    throughputPerMinute
  };
};

// ---------- Confusion Tracker (Composed from Pure Functions) ----------

export class ConfusionTracker {
  private patternVsClassifier = new Map<string, number>();
  private toolAccuracy = new Map<Tool, { correct: number; total: number }>();
  private commonFailures = new Map<string, number>();

  /**
   * Track a decision using functional composition
   * Category theory: This composes multiple morphisms
   */
  trackDecision(record: DecisionRecord): void {
    // Compose the analysis functions
    const patternAnalysis = analyzePatternVsClassifier(record);
    const toolAnalysis = analyzeToolAccuracy(record);
    const failureAnalysis = analyzeCommonFailures(record);
    
    // Apply monoidal operations to merge data
    this.patternVsClassifier = mergeConfusionData(this.patternVsClassifier, patternAnalysis);
    this.toolAccuracy = mergeToolAccuracy(this.toolAccuracy, toolAnalysis);
    this.commonFailures = mergeConfusionData(this.commonFailures, failureAnalysis);
  }

  /**
   * Get confusion matrix
   */
  getConfusionMatrix(): ConfusionMatrix {
    return {
      patternVsClassifier: new Map(this.patternVsClassifier),
      toolAccuracy: new Map(this.toolAccuracy),
      commonFailures: Array.from(this.commonFailures.entries())
        .map(([pattern, count]) => ({ pattern, count }))
        .sort((a, b) => b.count - a.count),
      performanceMetrics: this.calculatePerformanceMetrics()
    };
  }

  /**
   * Calculate performance metrics using pure functions
   * Category theory: This is a morphism DecisionRecord[] -> PerformanceMetrics
   */
  private calculatePerformanceMetrics(): PerformanceMetrics {
    const records = this.getAllRecords();
    return calculatePerformanceMetrics(records);
  }

  /**
   * Get all records (placeholder - would come from recorder)
   */
  private getAllRecords(): DecisionRecord[] {
    // This would be injected from the DecisionRecorder
    return [];
  }

  /**
   * Reset tracking data
   */
  reset(): void {
    this.patternVsClassifier.clear();
    this.toolAccuracy.clear();
    this.commonFailures.clear();
  }
}

// ---------- Replay System ----------

export class ReplaySystem {
  constructor(private recorder: DecisionRecorder) {}

  /**
   * Replay a decision
   */
  async replayDecision(
    decisionId: string,
    replayFunction: (input: string) => Promise<{ outcome: 'ok' | 'fail'; latMs: number; error?: string }>
  ): Promise<ReplayContext> {
    const originalRecord = this.recorder.getRecord(decisionId);
    if (!originalRecord) {
      throw new Error(`Decision record not found: ${decisionId}`);
    }

    const replayTimestamp = new Date();
    
    try {
      const result = await replayFunction(originalRecord.input);
      
      // Record the replay
      this.recorder.record({
        input: originalRecord.input,
        patternsMatched: originalRecord.patternsMatched,
        routerCandidates: originalRecord.routerCandidates,
        chosen: originalRecord.chosen,
        args: originalRecord.args,
        outcome: result.outcome,
        latMs: result.latMs,
        error: result.error,
        context: {
          replay: true,
          originalDecisionId: decisionId,
          originalOutcome: originalRecord.outcome
        }
      });

      return {
        decisionId,
        originalInput: originalRecord.input,
        originalOutcome: originalRecord.outcome,
        replayTimestamp
      };
    } catch (error) {
      throw new Error(`Replay failed: ${(error as Error).message}`);
    }
  }

  /**
   * Get replay statistics
   */
  getReplayStats(): {
    totalReplays: number;
    successfulReplays: number;
    failedReplays: number;
    outcomeChanges: number;
  } {
    const records = this.recorder.getAllRecords();
    const replayRecords = records.filter(r => r.context?.replay === true);
    
    const totalReplays = replayRecords.length;
    const successfulReplays = replayRecords.filter(r => r.outcome === 'ok').length;
    const failedReplays = replayRecords.filter(r => r.outcome === 'fail').length;
    
    const outcomeChanges = replayRecords.filter(r => {
      const originalOutcome = r.context?.originalOutcome;
      return originalOutcome && originalOutcome !== r.outcome;
    }).length;

    return {
      totalReplays,
      successfulReplays,
      failedReplays,
      outcomeChanges
    };
  }
}

// ---------- Observability Steps (Functional Composition) ----------

/**
 * Step to record a decision
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const recordDecisionStep = <T extends BaseContext>(
  params: {
    input: string;
    patternsMatched: string[];
    routerCandidates: RouterCandidate[];
    chosen: Tool[];
    args: Record<string, unknown>;
    outcome: 'ok' | 'fail';
    latMs: number;
    error?: string;
    context?: Record<string, unknown>;
  }
): Step<T> => {
  return async (state: T) => {
    const observability = state.observability as ObservabilityManager;
    if (!observability) {
      return state;
    }

    const recordId = observability.recorder.record(params);
    
    // Track for confusion analysis
    const record = observability.recorder.getRecord(recordId);
    if (record) {
      observability.confusionTracker.trackDecision(record);
    }
    
    return {
      ...state,
      lastDecisionId: recordId,
      decisionHistory: [...(state.decisionHistory as string[] || []), recordId]
    };
  };
};

/**
 * Step to get observability report
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const getObservabilityReportStep = <T extends BaseContext>(): Step<T> => {
  return async (state: T) => {
    const observability = state.observability as ObservabilityManager;
    if (!observability) {
      return state;
    }

    const report = observability.getReport();
    
    return {
      ...state,
      observabilityReport: report
    };
  };
};

// ---------- Observability Manager (Composed from Steps) ----------

export class ObservabilityManager {
  public readonly recorder: DecisionRecorder;
  public readonly confusionTracker: ConfusionTracker;
  public readonly replaySystem: ReplaySystem;

  constructor(maxRecords: number = 10000) {
    this.recorder = new DecisionRecorder(maxRecords);
    this.confusionTracker = new ConfusionTracker();
    this.replaySystem = new ReplaySystem(this.recorder);
  }

  /**
   * Record a complete decision with all context using functional composition
   */
  recordDecision(params: {
    input: string;
    patternsMatched: string[];
    routerCandidates: RouterCandidate[];
    chosen: Tool[];
    args: Record<string, unknown>;
    outcome: 'ok' | 'fail';
    latMs: number;
    error?: string;
    context?: Record<string, unknown>;
  }): string {
    const recordId = this.recorder.record(params);
    
    // Track for confusion analysis
    const record = this.recorder.getRecord(recordId);
    if (record) {
      this.confusionTracker.trackDecision(record);
    }
    
    return recordId;
  }

  /**
   * Get comprehensive observability report
   */
  getReport(): {
    confusionMatrix: ConfusionMatrix;
    recentDecisions: DecisionRecord[];
    replayStats: ReturnType<ReplaySystem['getReplayStats']>;
  } {
    return {
      confusionMatrix: this.confusionTracker.getConfusionMatrix(),
      recentDecisions: this.recorder.getRecentRecords(50),
      replayStats: this.replaySystem.getReplayStats()
    };
  }

  /**
   * Export data for analysis
   */
  exportData(): {
    decisions: DecisionRecord[];
    confusionMatrix: ConfusionMatrix;
  } {
    return {
      decisions: this.recorder.getAllRecords(),
      confusionMatrix: this.confusionTracker.getConfusionMatrix()
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.recorder.clear();
    this.confusionTracker.reset();
  }
}

// ---------- Integration with State (Functional Composition) ----------

/**
 * Pure function to add decision record to state
 * Category theory: This is a morphism (State, Decision) -> State
 */
export const appendDecision = <T extends BaseContext>(
  state: T,
  decision: Omit<DecisionRecord, 'id' | 'timestamp'>
): T => {
  const observability = state.observability as ObservabilityManager;
  if (!observability) {
    return state;
  }

  const recordId = observability.recordDecision(decision);
  
  return {
    ...state,
    lastDecisionId: recordId,
    decisionHistory: [...(state.decisionHistory as string[] || []), recordId]
  };
};

/**
 * Pure function to get decision history from state
 * Category theory: This is a morphism State -> DecisionRecord[]
 */
export const getDecisionHistory = <T extends BaseContext>(state: T): DecisionRecord[] => {
  const observability = state.observability as ObservabilityManager;
  const history = state.decisionHistory as string[] || [];
  
  if (!observability) {
    return [];
  }
  
  return history
    .map(id => observability.recorder.getRecord(id))
    .filter((record): record is DecisionRecord => record !== undefined);
};

/**
 * Step to append decision using functional composition
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const appendDecisionStep = <T extends BaseContext>(
  decision: Omit<DecisionRecord, 'id' | 'timestamp'>
): Step<T> => {
  return async (state: T) => {
    return appendDecision(state, decision);
  };
};

/**
 * Step to get decision history using functional composition
 * Category theory: This is a Kleisli arrow State -> Promise<State>
 */
export const getDecisionHistoryStep = <T extends BaseContext>(): Step<T> => {
  return async (state: T) => {
    const history = getDecisionHistory(state);
    return {
      ...state,
      decisionHistoryRecords: history
    };
  };
};

// ---------- Default Instance ----------

export const defaultObservabilityManager = new ObservabilityManager();
