# Multi-Agent Functional System for Domain-Specific Decision Making

This repository contains a collection of functional, type-safe, multi-agent systems built on category theory principles for domain-specific decision-making processes.

## Core Architecture

The system is built on a functional programming foundation (`index.ts`) that provides:

1. **Pure functions**: State transformations with no side effects
2. **Immutable data**: All state updates create new copies rather than mutating existing data
3. **Composition**: Complex workflows built from simpler, composable functions
4. **Type safety**: Leveraging TypeScript's type system to ensure correctness

The architecture follows several key functional patterns:
- **Monadic composition**: Sequential operations chained through bind operations
- **Lens-based state updates**: Focused updates to nested state elements
- **Structured logging**: Comprehensive event tracking with hash-based verification

## Agent Implementations

### TreeAgent (`treeAgent.ts`)

A question-refinement system that:
- Generates follow-up questions from an initial seed question
- Evaluates and scores generated questions
- Prunes low-scoring questions
- Iteratively refines concepts across multiple iterations
- Produces a tree of high-quality, related questions with answers

### UnderwritingAgent (`underwritingAgent.ts`)

An insurance underwriting decision system that:
- Simulates collaboration between different insurance roles (Agent, Underwriter, Actuary)
- Each persona evaluates applications from their unique expertise perspective
- Aggregates diverse viewpoints into a holistic risk assessment
- Produces structured decisions with specific terms and reasoning
- Handles complex policy applications with multi-dimensional risk factors

### CarePlanAgent (`carePlanAgent.ts`)

A healthcare coordination system that:
- Models a multidisciplinary team approach to patient care
- Incorporates clinical, care management, and family perspectives
- Enables sequential assessment, recommendation, and planning phases
- Generates comprehensive care plans with specific interventions
- Structures outputs into clinical, home service, safety, and caregiver components

## Novel Aspects

### Functional Composition vs. Traditional Agents

Unlike most agent frameworks that use object-oriented or procedural approaches, our system:

1. **Treats agents as functions**: Each agent is a pure state transformation function
2. **Uses category theory patterns**: Composition, associativity, and identity functions
3. **Maintains referential transparency**: Same inputs always produce same outputs
4. **Provides immutable state transitions**: Clear state history with no side effects

### Benefits Over Traditional Approaches

| Feature | Traditional Agents | Our Functional Agents |
|---------|-------------------|----------------------|
| State Management | Mutable state with side effects | Immutable state transitions |
| Debugging | Difficult due to hidden state changes | Transparent through event ledger |
| Composition | Often through inheritance or callbacks | First-class function composition |
| Concurrency | Complex due to shared state | Naturally parallelizable |
| Testing | Complex setup with mocking | Pure function testing |
| Types | Often dynamic or runtime checks | Static type checking |

### Domain-Specific Benefits

#### Insurance Underwriting

- Enables transparent, auditable decision trails for regulatory compliance
- Models each role's perspective individually before aggregation
- Structured output ideal for integration with policy administration systems
- Produces consistent decisions with clear reasoning

#### Healthcare Care Planning

- Captures interdisciplinary assessments in a coherent workflow
- Respects the unique perspective of each team member
- Facilitates care coordination across different providers
- Produces actionable, structured plans that can be implemented immediately

## Usage

Each agent can be run directly:

```bash
# Run tree agent for question refinement
npx ts-node src/treeAgent.ts

# Run underwriting agent for policy decisions
npx ts-node src/underwritingAgent.ts

# Run care planning agent for patient care
npx ts-node src/carePlanAgent.ts
```

## Extensions and Future Work

The functional architecture makes it easy to extend the system:

1. **RAG Integration**: Add retrieval-augmented generation by extending prompts with vector-searched content
2. **External Data Sources**: Connect to domain-specific APIs for real-time data
3. **Custom Agent Development**: Create new domain-specific agents using the same patterns
4. **Multi-step Reasoning**: Build more complex decision trees with depth-first or breadth-first exploration
5. **Explainable AI**: Generate rationales for decisions based on the event ledger

## Technical Implementation

The system leverages several advanced functional programming techniques:

1. **Higher-order functions**: For composition and transformation
2. **Monadic operations**: For sequential processing with context
3. **Functional lenses**: For focused state updates
4. **Type-level programming**: Using TypeScript's advanced type system
5. **Structured logging**: Comprehensive tracing of all state transitions

This architecture ensures robustness, auditability, and extensibility while maintaining type safety and functional purity. 