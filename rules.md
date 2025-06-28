# Quote Validation Rules System

## Overview

The Quote Validation Rules System is built on functional programming principles, providing a composable and extensible way to validate quotes. The system uses the Builder pattern combined with pure functions to create and evaluate rules.

## Core Concepts

### Rule Structure

Each rule is an immutable object with the following structure:

```typescript
interface ValidationRule {
  id: string;
  name: string;
  description: string;
  validate: (quote: Quote, context?: ValidationContext) => Promise<ValidationResult>;
}
```

### Validation Result

Rules produce a `ValidationResult`:

```typescript
interface ValidationResult {
  valid: boolean;
  ruleId: string;
  message: string;
  severity: ValidationSeverity;
}
```

## Built-in Rules

### 1. Status Check Rule
- **ID**: `STATUS_CHECK`
- **Purpose**: Validates quote status
- **Behavior**: Ensures quote is in the correct status (case-insensitive)
- **Severity**: Error

### 2. Metadata Check Rule
- **ID**: `METADATA_CHECK`
- **Purpose**: Validates required metadata
- **Behavior**: Checks for required fields ('approver', 'department')
- **Severity**: Warning

### 3. Dynamic Rules

#### Opportunity Amount Match
- **Purpose**: Validates quote amount against opportunity
- **Behavior**: Ensures quote amount is within margin of opportunity amount
- **Severity**: Warning

#### Dynamic Min/Max Amount
- **Purpose**: Validates amount thresholds based on account rating
- **Behavior**: Enforces minimum and maximum amounts
- **Severity**: Error

#### Product Validation
- **Purpose**: Validates product existence
- **Behavior**: Ensures all products in line items exist
- **Severity**: Error

## Extending the System

### Creating New Rules

Use the `RuleBuilder` to create new rules through functional composition:

```typescript
const newRule = RuleBuilder
  .create('RULE_ID', 'Rule Name', 'Rule Description')
  .withValidation(validationFn)
  .withMessage(messageFn)
  .withSeverity(severity);
```

### Available Predicates

The system provides composable predicates for common validations:

#### Amount Predicates
```typescript
Predicates.amount.min(threshold)
Predicates.amount.max(threshold)
Predicates.amount.withinOpportunityRange(margin)
```

#### Status Predicates
```typescript
Predicates.status.is(status)
Predicates.status.isNot(status)
Predicates.status.validTransition(fromStatus, toStatus)
```

#### Metadata Predicates
```typescript
Predicates.metadata.has(key)
Predicates.metadata.hasAll(requiredFields)
Predicates.metadata.matches(key, predicate)
```

#### Line Item Predicates
```typescript
Predicates.lineItems.minCount(min)
Predicates.lineItems.totalAmount(predicate)
Predicates.lineItems.validProducts()
```

### Message Templates

Use the `Messages` module for consistent message formatting:

```typescript
Messages.amount.min(threshold)
Messages.amount.max(threshold)
Messages.amount.opportunityMatch
Messages.status.is(status)
Messages.status.transition(fromStatus, toStatus)
Messages.metadata.missing(requiredFields)
```

## Using the Rules System

### Basic Usage

```typescript
const results = await validateQuote(standardRules)(quote);
```

### With Context

```typescript
const context = await getValidationContext(conn, quote);
const results = await validateQuote(standardRules)(quote, conn);
```

### Result Combinators

Use functional combinators to analyze results:

```typescript
Combinators.all(results)              // Check if all rules passed
Combinators.anyErrors(results)        // Check for any errors
Combinators.onlyWarnings(results)     // Check for only warnings
Combinators.filterBySeverity(severity) // Filter by severity
Combinators.getFailedValidations(results) // Get failed validations
```

## Best Practices

1. **Immutability**: Always return new objects instead of modifying existing ones
2. **Pure Functions**: Keep validation functions pure and side-effect free
3. **Composition**: Use functional composition to build complex rules
4. **Context**: Use ValidationContext for external dependencies
5. **Async/Await**: All validations are asynchronous for consistency

## Example: Adding a Custom Rule

```typescript
// Create a custom rule for quote expiration
const expirationRule = RuleBuilder
  .create(
    'EXPIRATION_CHECK',
    'Quote Expiration',
    'Validates quote has not expired'
  )
  .withValidation(
    async (quote: Quote) => {
      const expirationDate = new Date(quote.metadata.expirationDate);
      return expirationDate > new Date();
    }
  )
  .withMessage(
    (quote: Quote, valid: boolean) =>
      valid
        ? `Quote is still valid`
        : `Quote has expired on ${quote.metadata.expirationDate}`
  )
  .withSeverity(ValidationSeverity.Error);

// Add to standard rules
standardRules.push(expirationRule);
``` 