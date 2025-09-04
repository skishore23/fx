import { 
  step, 
  sequence, 
  parallel, 
  when,
  updateState, 
  addState,
  enableLogging,
  disableLogging,
  logEvent,
  getEvents,
  clearEvents
} from '../index';
import { clone } from '../utils';

interface IntegrationState {
  value: number;
  message: string;
  memory: any[];
  processed: boolean;
  errors: string[];
  processedAt?: Date;
  processedInput?: string;
  response?: string;
  userInput?: string;
  [key: string]: any;
}

describe('Integration Tests - All Fixes Working Together', () => {
  beforeEach(() => {
    clearEvents();
    disableLogging();
  });

  describe('Error Handling Integration', () => {
    it('should handle parallel execution failures with proper error propagation', async () => {
      enableLogging();
      
      const successStep = step('success', (state: IntegrationState) => 
        updateState({ message: 'success' })(state)
      );
      
      const failingStep = step('failing', (state: IntegrationState) => {
        throw new Error('Step failed');
      });
      
      const workflow = parallel([successStep, failingStep]);
      
      await expect(workflow({ 
        value: 5, 
        message: 'initial', 
        memory: [], 
        processed: false, 
        errors: [] 
      })).rejects.toThrow('Parallel execution failed: 1 steps failed');
      
      // Verify events were logged
      const events = getEvents();
      expect(events.length).toBeGreaterThan(0);
    });

    it('should handle sequence execution with proper state flow', async () => {
      const step1 = step('step1', (state: IntegrationState) => 
        updateState({ value: state.value + 1 })(state)
      );
      
      const step2 = step('step2', (state: IntegrationState) => 
        updateState({ message: `Value is ${state.value}` })(state)
      );
      
      const step3 = step('step3', (state: IntegrationState) => 
        addState('action', `Processed value ${state.value}`)(state)
      );
      
      const workflow = sequence([step1, step2, step3]);
      const result = await workflow({ 
        value: 5, 
        message: 'initial', 
        memory: [], 
        processed: false, 
        errors: [] 
      });
      
      expect(result.value).toBe(6);
      expect(result.message).toBe('Value is 6');
      expect(result.memory).toHaveLength(1);
      expect(result.memory[0].content).toBe('Processed value 6');
    });
  });

  describe('Memory Management Integration', () => {
    it('should handle memory operations without leaks', async () => {
      enableLogging();
      
      // Log many events to test cleanup
      for (let i = 0; i < 1200; i++) {
        logEvent(`test-event-${i}`, { index: i });
      }
      
      const events = getEvents();
      expect(events.length).toBeLessThanOrEqual(1000); // Should be cleaned up
      
      // Verify most recent events are preserved
      const lastEvent = events[events.length - 1];
      expect(lastEvent?.name).toMatch(/^test-event-\d+$/);
    });

    it('should handle complex state transformations with memory', async () => {
      const processStep = step('process', (state: IntegrationState) => {
        const newState = updateState({ 
          processed: true,
          value: state.value * 2 
        })(state);
        
        return addState('action', `Processed value ${state.value} -> ${newState.value}`)(newState);
      });
      
      const validateStep = step('validate', (state: IntegrationState) => {
        if (state.value < 10) {
          return addState('error', `Value ${state.value} is too small`)(state);
        }
        return addState('success', `Value ${state.value} is valid`)(state);
      });
      
      const workflow = sequence([processStep, validateStep]);
      const result = await workflow({ 
        value: 3, 
        message: 'initial', 
        memory: [], 
        processed: false, 
        errors: [] 
      });
      
      expect(result.processed).toBe(true);
      expect(result.value).toBe(6);
      expect(result.memory).toHaveLength(2);
      expect(result.memory[0].content).toContain('Processed value 3 -> 6');
      expect(result.memory[1].content).toContain('Value 6 is too small');
    });
  });

  describe('Performance Integration', () => {
    it('should handle deep cloning efficiently', () => {
      const complexState: IntegrationState = {
        value: 42,
        message: 'test',
        memory: [],
        processed: false,
        errors: [],
        nested: {
          deep: {
            structure: {
              with: {
                arrays: [1, 2, { nested: true }],
                dates: [new Date('2023-01-01')],
                maps: new Map([['key', 'value']]),
                sets: new Set([1, 2, 3])
              }
            }
          }
        }
      };
      
      const cloned = clone(complexState);
      
      expect(cloned).toEqual(complexState);
      expect(cloned).not.toBe(complexState);
      expect(cloned.nested).not.toBe(complexState.nested);
      expect(cloned.nested.deep.structure.with.dates[0]).not.toBe(complexState.nested.deep.structure.with.dates[0]);
      expect(cloned.nested.deep.structure.with.maps).not.toBe(complexState.nested.deep.structure.with.maps);
      expect(cloned.nested.deep.structure.with.sets).not.toBe(complexState.nested.deep.structure.with.sets);
    });

    it('should handle large state objects efficiently', async () => {
      const largeState: IntegrationState = {
        value: 1,
        message: 'large state test',
        memory: [],
        processed: false,
        errors: [],
        largeArray: new Array(1000).fill(0).map((_, i) => ({ index: i, data: `item-${i}` })),
        largeObject: Object.fromEntries(
          new Array(100).fill(0).map((_, i) => [`key${i}`, { value: i, nested: { deep: true } }])
        )
      };
      
      const processStep = step('process-large', (state: IntegrationState) => {
        const cloned = clone(state);
        return updateState({ 
          processed: true,
          processedAt: new Date()
        } as Partial<IntegrationState>)(cloned);
      });
      
      const result = await processStep(largeState);
      
      expect(result.processed).toBe(true);
      expect(result.largeArray).toHaveLength(1000);
      expect(result.largeObject).toHaveProperty('key0');
      expect(result.processedAt).toBeInstanceOf(Date);
    });
  });

  describe('Type Safety Integration', () => {
    it('should maintain type safety through complex workflows', async () => {
      const typedStep = step('typed', (state: IntegrationState) => {
        // This should compile without type errors
        const newValue = state.value + 1;
        const newMessage = `Value is now ${newValue}`;
        
        return updateState({
          value: newValue,
          message: newMessage,
          processed: true
        })(state);
      });
      
      const conditionalStep = when(
        (state: IntegrationState) => state.value > 5,
        step('high-value', (state: IntegrationState) => 
          addState('info', `High value detected: ${state.value}`)(state)
        ),
        step('low-value', (state: IntegrationState) => 
          addState('warning', `Low value: ${state.value}`)(state)
        )
      );
      
      const workflow = sequence([typedStep, conditionalStep]);
      
      const result1 = await workflow({ 
        value: 3, 
        message: 'initial', 
        memory: [], 
        processed: false, 
        errors: [] 
      });
      
      expect(result1.value).toBe(4);
      expect(result1.message).toBe('Value is now 4');
      expect(result1.memory[0].content).toContain('Low value: 4');
      
      const result2 = await workflow({ 
        value: 6, 
        message: 'initial', 
        memory: [], 
        processed: false, 
        errors: [] 
      });
      
      expect(result2.value).toBe(7);
      expect(result2.memory[0].content).toContain('High value detected: 7');
    });
  });

  describe('Input Validation Integration', () => {
    it('should validate inputs at composition boundaries', () => {
      // Test sequence validation
      expect(() => sequence(null as any)).toThrow('Steps must be an array');
      expect(() => sequence([step('valid', (s: any) => s), 'invalid' as any])).toThrow('Step at index 1 is not a function');
      
      // Test parallel validation
      expect(() => parallel(null as any)).toThrow('Steps must be an array');
      expect(() => parallel([step('valid', (s: any) => s), 'invalid' as any])).toThrow('Step at index 1 is not a function');
      
      // Test when validation
      expect(() => when(null as any, step('test', (s: IntegrationState) => s))).toThrow('Predicate must be a function');
      expect(() => when(() => true, null as any)).toThrow('Then step must be a function');
    });
  });

  describe('Real-world Scenario', () => {
    it('should handle a complete agent workflow', async () => {
      enableLogging();
      
      // Simulate a complete agent workflow
      const receiveInput = step('receive-input', (state: IntegrationState) => 
        addState('action', `Received input: ${state.userInput}`)(state)
      );
      
      const processInput = step('process-input', (state: IntegrationState) => {
        const processed = state.userInput?.trim().toLowerCase() || '';
        return updateState({ 
          processedInput: processed,
          value: processed.length 
        } as Partial<IntegrationState>)(state);
      });
      
      const validateInput = step('validate-input', (state: IntegrationState) => {
        if (!state.processedInput || state.processedInput.length === 0) {
          return addState('error', 'Input is empty or invalid')(state);
        }
        return addState('success', 'Input is valid')(state);
      });
      
      const generateResponse = step('generate-response', (state: IntegrationState) => {
        const response = `Processed: "${state.processedInput}" (${state.value} characters)`;
        return updateState({ 
          response,
          processed: true 
        } as Partial<IntegrationState>)(state);
      });
      
      const logResult = step('log-result', (state: IntegrationState) => 
        addState('action', `Generated response: ${state.response}`)(state)
      );
      
      const workflow = sequence([
        receiveInput,
        processInput,
        validateInput,
        generateResponse,
        logResult
      ]);
      
      const result = await workflow({
        userInput: '  Hello World  ',
        value: 0,
        message: '',
        memory: [],
        processed: false,
        errors: []
      });
      
      // Verify the complete workflow
      expect(result.processedInput).toBe('hello world');
      expect(result.value).toBe(11);
      expect(result.response).toBe('Processed: "hello world" (11 characters)');
      expect(result.processed).toBe(true);
      expect(result.memory).toHaveLength(4);
      
      // Verify memory entries
      expect(result.memory[0].content).toContain('Received input:   Hello World  ');
      expect(result.memory[1].content).toBe('Input is valid');
      expect(result.memory[2].content).toContain('Generated response:');
      
      // Verify events were logged
      const events = getEvents();
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery Integration', () => {
    it('should handle errors gracefully with proper state preservation', async () => {
      enableLogging();
      
      const safeStep = step('safe', (state: IntegrationState) => 
        addState('action', 'Safe step executed')(state)
      );
      
      const riskyStep = step('risky', (state: IntegrationState) => {
        if (state.value > 5) {
          throw new Error('Value too high');
        }
        return addState('action', 'Risky step executed')(state);
      });
      
      const recoveryStep = step('recovery', (state: IntegrationState) => 
        addState('action', 'Recovery step executed')(state)
      );
      
      // Use tryInOrder to handle the risky step
      const workflow = sequence([
        safeStep,
        riskyStep,
        recoveryStep
      ]);
      
      // Test with safe value
      const safeResult = await workflow({
        value: 3,
        message: 'safe',
        memory: [],
        processed: false,
        errors: []
      });
      
      expect(safeResult.memory).toHaveLength(3);
      expect(safeResult.memory[1].content).toBe('Risky step executed');
      
      // Test with risky value
      const riskyResult = await workflow({
        value: 7,
        message: 'risky',
        memory: [],
        processed: false,
        errors: []
      });
      
      // Should have safe step and recovery step, but not risky step
      expect(riskyResult.memory).toHaveLength(2);
      expect(riskyResult.memory[0].content).toBe('Safe step executed');
      expect(riskyResult.memory[1].content).toBe('Recovery step executed');
    });
  });
});
