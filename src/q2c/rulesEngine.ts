import { 
  Quote, 
  ValidationRule, 
  ValidationResult, 
  ValidationSeverity, 
  QuoteStatus,
  Opportunity,
  Account,
  QuoteLineItem
} from './types';
import { z } from 'zod';
import Fx from '../index';
import { SalesforceAPI } from './salesforce';
import { Connection } from 'jsforce';

// Enhanced Rule builder with context
export const RuleBuilder = {
  create: (
    id: string,
    name: string,
    description: string
  ) => ({
    withValidation: (validateFn: (quote: Quote, context?: ValidationContext) => Promise<boolean>) => ({
      withMessage: (messageFn: (quote: Quote, valid: boolean, context?: ValidationContext) => string) => ({
        withSeverity: (severity: ValidationSeverity): ValidationRule => ({
          id,
          name,
          description,
          validate: async (quote: Quote, context?: ValidationContext): Promise<ValidationResult> => {
            const valid = await validateFn(quote, context);
            return {
              valid,
              ruleId: id,
              message: messageFn(quote, valid, context),
              severity
            };
          }
        })
      })
    })
  })
};

// Validation context interface
interface ValidationContext {
  opportunity?: Opportunity;
  account?: Account;
  customRules?: Map<string, ValidationRule>;
  thresholds?: {
    minAmount?: number;
    maxAmount?: number;
    requiredFields?: string[];
  };
  conn?: Connection;
}

// Enhanced predicates with context
export const Predicates = {
  amount: {
    min: (getMin: (context?: ValidationContext) => number) => 
      async (quote: Quote, context?: ValidationContext) => 
        quote.amount >= getMin(context),
    
    max: (getMax: (context?: ValidationContext) => number) => 
      async (quote: Quote, context?: ValidationContext) => 
        quote.amount <= getMax(context),
    
    withinOpportunityRange: (margin: number = 0.1) => 
      async (quote: Quote, context?: ValidationContext) => {
        if (!context?.opportunity?.amount) return true;
        const oppAmount = context.opportunity.amount;
        const lowerBound = oppAmount * (1 - margin);
        const upperBound = oppAmount * (1 + margin);
        return quote.amount >= lowerBound && quote.amount <= upperBound;
      }
  },
  
  status: {
    is: (status: QuoteStatus) => async (quote: Quote) => 
      quote.status.toUpperCase() === status,
    isNot: (status: QuoteStatus) => async (quote: Quote) => 
      quote.status.toUpperCase() !== status,
    validTransition: (fromStatus: QuoteStatus, toStatus: QuoteStatus) => 
      async (quote: Quote) => {
        const validTransitions = new Map([
          ['DRAFT', ['PENDING', 'REJECTED']],
          ['PENDING', ['APPROVED', 'REJECTED']],
          ['APPROVED', ['ACTIVATED']],
          ['REJECTED', ['DRAFT']]
        ]);
        const currentStatus = quote.status.toUpperCase();
        return validTransitions.get(fromStatus)?.includes(toStatus) || false;
      }
  },
  
  metadata: {
    has: (key: string) => async (quote: Quote) => 
      quote.metadata && typeof quote.metadata[key] !== 'undefined',
    
    hasAll: (getRequiredFields: (context?: ValidationContext) => string[]) => 
      async (quote: Quote, context?: ValidationContext) => {
        const fields = getRequiredFields(context);
        return quote.metadata && fields.every(k => typeof quote.metadata[k] !== 'undefined');
      },
    
    matches: (key: string, predicate: (value: any) => boolean) => async (quote: Quote) =>
      quote.metadata && predicate(quote.metadata[key])
  },
  
  lineItems: {
    minCount: (min: number) => async (quote: Quote) => quote.lineItems.length >= min,
    
    totalAmount: (predicate: (amount: number) => boolean) => async (quote: Quote) => {
      const total = quote.lineItems.reduce<number>(
        (sum, item: QuoteLineItem) => sum + (item.totalPrice || 0), 
        0
      );
      return predicate(total);
    },
    
    validProducts: () => async (quote: Quote, context?: ValidationContext) => {
      if (!context?.conn) return true;
      const products = await SalesforceAPI.fetchProducts(context.conn as Connection);
      const productIds = new Set(products.map(p => p.id));
      return quote.lineItems.every((item: QuoteLineItem) => productIds.has(item.productId));
    }
  }
};

// Enhanced message templates with context
export const Messages = {
  amount: {
    min: (getMin: (context?: ValidationContext) => number) => 
      (quote: Quote, valid: boolean, context?: ValidationContext) => {
        const min = getMin(context);
        return valid 
          ? `Quote amount ($${quote.amount}) meets minimum of $${min}` 
          : `Quote amount ($${quote.amount}) is below minimum of $${min}`;
      },
    
    max: (getMax: (context?: ValidationContext) => number) => 
      (quote: Quote, valid: boolean, context?: ValidationContext) => {
        const max = getMax(context);
        return valid 
          ? `Quote amount ($${quote.amount}) is within maximum of $${max}`
          : `Quote amount ($${quote.amount}) exceeds maximum of $${max}`;
      },
    
    opportunityMatch: (quote: Quote, valid: boolean, context?: ValidationContext) =>
      valid
        ? `Quote amount ($${quote.amount}) aligns with opportunity amount ($${context?.opportunity?.amount})`
        : `Quote amount ($${quote.amount}) significantly differs from opportunity amount ($${context?.opportunity?.amount})`
  },
  
  status: {
    is: (status: QuoteStatus) => (quote: Quote, valid: boolean) =>
      valid 
        ? `Quote is in ${status} status as required`
        : `Quote must be in ${status} status (current: ${quote.status})`,
    
    transition: (fromStatus: QuoteStatus, toStatus: QuoteStatus) => 
      (quote: Quote, valid: boolean) =>
        valid
          ? `Valid status transition from ${fromStatus} to ${toStatus}`
          : `Invalid status transition from ${fromStatus} to ${toStatus}`
  },
  
  metadata: {
    missing: (getRequiredFields: (context?: ValidationContext) => string[]) => 
      (quote: Quote, valid: boolean, context?: ValidationContext) => {
        const fields = getRequiredFields(context);
        return valid 
          ? `Quote has all required metadata fields`
          : `Quote is missing required metadata: ${fields.join(', ')}`;
      }
  }
};

// Function to fetch validation context
export const getValidationContext = async (
  conn: Connection,
  quote: Quote
): Promise<ValidationContext> => {
  try {
    // Fetch related opportunity and account
    const opportunity = await SalesforceAPI.fetchRelatedOpportunity(conn, quote.id);
    const account = await SalesforceAPI.fetchAccountDetails(conn, opportunity.accountId);
    
    // Define thresholds based on account type/rating
    const thresholds = {
      minAmount: account.rating === 'Hot' ? 1000 : 100,
      maxAmount: account.rating === 'Hot' ? 1000000 : 100000,
      requiredFields: ['approver', 'department']
    };
    
    return {
      opportunity,
      account,
      thresholds,
      conn
    };
  } catch (error) {
    console.error('Error fetching validation context:', error);
    return {};
  }
};

// Dynamic rule generation based on context
export const getDynamicRules = async (
  conn: Connection,
  quote: Quote
): Promise<ValidationRule[]> => {
  const context = await getValidationContext(conn, quote);
  
  return [
    // Amount validation based on opportunity
    RuleBuilder
      .create('OPPORTUNITY_AMOUNT_MATCH', 'Opportunity Amount Match', 'Validates quote amount against opportunity')
      .withValidation(Predicates.amount.withinOpportunityRange(0.1))
      .withMessage(Messages.amount.opportunityMatch)
      .withSeverity(ValidationSeverity.Warning),

    // Dynamic minimum amount based on account rating
    RuleBuilder
      .create('DYNAMIC_MIN_AMOUNT', 'Dynamic Minimum Amount', 'Validates minimum quote amount based on account')
      .withValidation(Predicates.amount.min(() => context.thresholds?.minAmount || 100))
      .withMessage(Messages.amount.min(() => context.thresholds?.minAmount || 100))
      .withSeverity(ValidationSeverity.Error),

    // Dynamic maximum amount based on account rating
    RuleBuilder
      .create('DYNAMIC_MAX_AMOUNT', 'Dynamic Maximum Amount', 'Validates maximum quote amount based on account')
      .withValidation(Predicates.amount.max(() => context.thresholds?.maxAmount || 100000))
      .withMessage(Messages.amount.max(() => context.thresholds?.maxAmount || 100000))
      .withSeverity(ValidationSeverity.Error),

    // Required metadata fields based on account type
    RuleBuilder
      .create('DYNAMIC_METADATA_CHECK', 'Dynamic Metadata Check', 'Validates required metadata based on account')
      .withValidation(Predicates.metadata.hasAll(() => context.thresholds?.requiredFields || []))
      .withMessage(Messages.metadata.missing(() => context.thresholds?.requiredFields || []))
      .withSeverity(ValidationSeverity.Warning),

    // Product validation
    RuleBuilder
      .create('VALID_PRODUCTS', 'Valid Products', 'Validates that all products in line items exist')
      .withValidation(Predicates.lineItems.validProducts())
      .withMessage((_, valid) => valid ? 'All products are valid' : 'Quote contains invalid products')
      .withSeverity(ValidationSeverity.Error)
  ];
};

// Enhanced validation function
export const validateQuote = (rules: ValidationRule[]) => 
  async (quote: Quote, conn?: Connection): Promise<ValidationResult[]> => {
    const context = conn ? await getValidationContext(conn, quote) : undefined;
    const dynamicRules = conn ? await getDynamicRules(conn, quote) : [];
    const allRules = [...rules, ...dynamicRules];
    
    const results = await Promise.all(
      allRules.map(async rule => {
        try {
          return await rule.validate(quote, context);
        } catch (error) {
          console.error(`Error in rule ${rule.id}:`, error);
          return {
            valid: false,
            ruleId: rule.id,
            message: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            severity: ValidationSeverity.Error
          };
        }
      })
    );

    return results;
};

// Register validation tools
export const registerValidationTools = () => {
  const QuoteSchema = z.object({
    id: z.string(),
    name: z.string(),
    amount: z.number(),
    status: z.nativeEnum(QuoteStatus),
    createdAt: z.date(),
    lastModifiedAt: z.date(),
    lineItems: z.array(z.object({
      id: z.string(),
      productId: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      totalPrice: z.number()
    })),
    metadata: z.record(z.unknown())
  }).strict();

  // Register single rule validation
  Fx.registerTool<ValidationResult[], z.ZodTuple<[typeof QuoteSchema, z.ZodString]>>(
    'rules.validateSingle',
    z.tuple([QuoteSchema, z.string()]),
    (quoteData: z.infer<typeof QuoteSchema>, ruleId: string) => 
      async (state: readonly ValidationResult[]): Promise<ValidationResult[]> => {
        const rule = standardRules.find(r => r.id === ruleId);
        if (!rule) throw new Error(`Rule ${ruleId} not found`);
        const result = await rule.validate(quoteData as Quote);
        return [result];
      }
  );

  // Register full validation
  Fx.registerTool<ValidationResult[], z.ZodTuple<[typeof QuoteSchema]>>(
    'rules.validateAll',
    z.tuple([QuoteSchema]),
    (quoteData: z.infer<typeof QuoteSchema>) => 
      async (state: readonly ValidationResult[]): Promise<ValidationResult[]> => {
        const results = await validateQuote(standardRules)(quoteData as Quote);
        return results;
      }
  );
};

// Initialize tools
registerValidationTools();

// Standard validation rules (base rules that don't require context)
export const standardRules: ValidationRule[] = [
  RuleBuilder
    .create('STATUS_CHECK', 'Status Check', 'Validates quote status')
    .withValidation(Predicates.status.is(QuoteStatus.Draft))
    .withMessage((quote: Quote, valid: boolean) => 
      `Quote ${valid ? 'is in required DRAFT status' : 'must be in DRAFT status'} (current: ${quote.status})`)
    .withSeverity(ValidationSeverity.Error),

  RuleBuilder
    .create('METADATA_CHECK', 'Metadata Check', 'Validates required metadata')
    .withValidation(Predicates.metadata.hasAll(() => ['approver', 'department']))
    .withMessage((_: Quote, valid: boolean) => 
      `Quote ${valid ? 'has all required metadata' : 'is missing required metadata'}: approver, department`)
    .withSeverity(ValidationSeverity.Warning)
];

// Validation result combinators
export const Combinators = {
  all: (results: ValidationResult[]): boolean =>
    results.every(result => result.valid),
    
  anyErrors: (results: ValidationResult[]): boolean =>
    results.some(result => !result.valid && result.severity === ValidationSeverity.Error),
    
  onlyWarnings: (results: ValidationResult[]): boolean =>
    results.some(result => !result.valid && result.severity === ValidationSeverity.Warning) && 
    !results.some(result => !result.valid && result.severity === ValidationSeverity.Error),
    
  filterBySeverity: (severity: ValidationSeverity) => (results: ValidationResult[]): ValidationResult[] =>
    results.filter(result => result.severity === severity),

  getFailedValidations: (results: ValidationResult[]): ValidationResult[] =>
    results.filter(result => !result.valid)
}; 