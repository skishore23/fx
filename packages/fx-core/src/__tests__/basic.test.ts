import { 
  step, 
  sequence, 
  updateState, 
  addState
} from '../index';

interface TestState {
  value: number;
  message?: string;
  memory: any[];
  [key: string]: any;
}

describe('Fx Core - Basic Functionality', () => {
  describe('step function', () => {
    it('should create a step that transforms state', async () => {
      const incrementStep = step('increment', (state: TestState) => {
        return updateState({ value: state.value + 1 })(state);
      });

      const result = await incrementStep({ value: 5, memory: [] });
      expect(result.value).toBe(6);
    });

    it('should handle async operations', async () => {
      const asyncStep = step('async', async (state: TestState) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return updateState({ value: state.value * 2 })(state);
      });

      const result = await asyncStep({ value: 3, memory: [] });
      expect(result.value).toBe(6);
    });
  });

  describe('sequence composition', () => {
    it('should run steps in order', async () => {
      const step1 = step('step1', (state: TestState) => 
        updateState({ step1: true })(state)
      );
      const step2 = step('step2', (state: TestState) => 
        updateState({ step2: true })(state)
      );

      const workflow = sequence([step1, step2]);
      const result = await workflow({ value: 0, memory: [] });

      expect(result.step1).toBe(true);
      expect(result.step2).toBe(true);
    });

    it('should pass state between steps', async () => {
      const step1 = step('step1', (state: TestState) => 
        updateState({ value: state.value + 1 })(state)
      );
      const step2 = step('step2', (state: TestState) => 
        updateState({ value: state.value * 2 })(state)
      );

      const workflow = sequence([step1, step2]);
      const result = await workflow({ value: 5, memory: [] });

      expect(result.value).toBe(12); // (5 + 1) * 2
    });
  });

  describe('state operations', () => {
    it('should update state with updateState', () => {
      const updateFn = updateState({ value: 10, message: 'updated' });
      const result = updateFn({ value: 5, memory: [] });

      expect(result.value).toBe(10);
      expect(result.message).toBe('updated');
    });

    it('should add memory entries with addState', () => {
      const addFn = addState('action', 'User logged in');
      const result = addFn({ value: 5, memory: [] });

      expect(result.memory).toHaveLength(1);
      expect((result as any).memory[0].type).toBe('action');
      expect((result as any).memory[0].content).toBe('User logged in');
    });

    it('should sequence steps', async () => {
      const step1 = step('step1', (state: TestState) => 
        updateState({ value: 10 })(state)
      );
      const step2 = step('step2', (state: TestState) => 
        updateState({ message: 'sequenced' })(state)
      );
      
      const sequenced = sequence([step1, step2]);
      const result = await sequenced({ value: 5, memory: [] });

      expect(result.value).toBe(10);
      expect(result.message).toBe('sequenced');
    });

    it('should sequence many steps', async () => {
      const steps = [
        step('step1', (state: TestState) => updateState({ value: 10 })(state)),
        step('step2', (state: TestState) => updateState({ message: 'first' })(state)),
        step('step3', (state: TestState) => addState('action', 'sequenced')(state))
      ];
      
      const sequenced = sequence(steps);
      const result = await sequenced({ value: 5, memory: [] });

      expect(result.value).toBe(10);
      expect(result.message).toBe('first');
      expect(result.memory).toHaveLength(1);
    });
  });

  describe('integration', () => {
    it('should work with complex workflows', async () => {
      const processInput = step('processInput', (state: TestState) => 
        updateState({ userInput: state.userInput?.trim() })(state)
      );

      const generateResponse = step('generateResponse', (state: TestState) => 
        updateState({ response: `Hello ${state.userInput}` })(state)
      );

      const logAction = step('logAction', (state: TestState) => 
        addState('action', `Generated response for: ${state.userInput}`)(state)
      );

      const workflow = sequence([processInput, generateResponse, logAction]);
      
      const result = await workflow({ 
        value: 0,
        userInput: '  World  ', 
        memory: [] 
      });

      expect(result.userInput).toBe('World');
      expect(result.response).toBe('Hello World');
      expect(result.memory).toHaveLength(1);
      expect((result as any).memory[0].content).toBe('Generated response for: World');
    });
  });
});
