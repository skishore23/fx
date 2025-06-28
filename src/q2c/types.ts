import { z } from 'zod';
import * as jsforce from 'jsforce';
import { Connection } from 'jsforce';

// Core domain types
export type QuoteId = string;

// Quote data structure
export interface Quote {
  id: QuoteId;
  name: string;
  amount: number;
  status: string;
  createdAt: Date;
  lastModifiedAt: Date;
  lineItems: QuoteLineItem[];
  billingAddress?: Address;
  shippingAddress?: Address;
  metadata: Record<string, unknown>;
}

export enum QuoteStatus {
  Draft = 'DRAFT',
  UnderReview = 'UNDER_REVIEW',
  Approved = 'APPROVED',
  Rejected = 'REJECTED'
}

export interface QuoteLineItem {
  id: string;
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

// Validation rule types
export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  validate: (quote: Quote, context?: ValidationContext) => Promise<ValidationResult>;
}

export interface ValidationResult {
  valid: boolean;
  ruleId: string;
  message: string;
  severity: ValidationSeverity;
}

export enum ValidationSeverity {
  Info = 'INFO',
  Warning = 'WARNING',
  Error = 'ERROR'
}

// Add ValidationContext interface
export interface ValidationContext {
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

// Agent state type
export interface Q2CAgentState {
  quotes: Quote[];
  validationResults: Map<QuoteId, ValidationResult[]>;
  pendingActions: AgentAction[];
  errors: AgentError[];
  metadata: {
    token: OAuthToken | null;
  };
  isComplete: boolean;
  lineItems: Map<QuoteId, QuoteLineItem[]>;
  opportunities: Map<string, Opportunity>;
  accounts: Map<string, Account>;
  products: Product[];
  pricebookEntries: Map<string, PricebookEntry[]>;
  contracts: Contract[];
  approvalProcesses: Map<QuoteId, ApprovalProcess>;
  documents: Map<QuoteId, string>;
  lastThought?: {
    observation: string;
    reasoning: string;
    action: {
      type: AgentActionType;
      quoteId: string;
      reason: string;
    };
  };
}

export interface AgentAction {
  id: string;
  quoteId: QuoteId;
  type: AgentActionType;
  status: AgentActionStatus;
  createdAt: Date;
  completedAt?: Date;
  error?: AgentError;
}

export enum AgentActionType {
  FetchQuote = 'FETCH_QUOTE',
  ValidateQuote = 'VALIDATE_QUOTE',
  ApproveQuote = 'APPROVE_QUOTE',
  RejectQuote = 'REJECT_QUOTE',
  EscalateQuote = 'ESCALATE_QUOTE',
  FetchLineItems = 'FETCH_LINE_ITEMS',
  FetchOpportunity = 'FETCH_OPPORTUNITY',
  GenerateDocument = 'GENERATE_DOCUMENT',
  SubmitForApproval = 'SUBMIT_FOR_APPROVAL',
  CreateContract = 'CREATE_CONTRACT',
  UpdateQuote = 'UPDATE_QUOTE',
  Complete = 'COMPLETE'
}

export enum AgentActionStatus {
  Pending = 'PENDING',
  InProgress = 'IN_PROGRESS',
  Completed = 'COMPLETED',
  Failed = 'FAILED'
}

export interface AgentError {
  id: string;
  message: string;
  code: string;
  timestamp: Date;
  context: Record<string, unknown>;
}

// Zod schemas for runtime validation
export const QuoteSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number(),
  status: z.string(),
  createdAt: z.date(),
  lastModifiedAt: z.date(),
  lineItems: z.array(z.unknown()).default([]),
  metadata: z.record(z.unknown())
});

// Either monad for error handling
export type Either<E, A> = Left<E> | Right<A>;

export interface Left<E> {
  readonly _tag: 'Left';
  readonly left: E;
}

export interface Right<A> {
  readonly _tag: 'Right';
  readonly right: A;
}

// OAuth types
export interface SalesforceConfig {
  clientId: string;
  loginUrl?: string;
  subject: string;
}

export interface OAuthToken {
  access_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature?: string;
}

export interface OAuthError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

// OAuth Zod schemas
export const OAuthTokenSchema = z.object({
  access_token: z.string(),
  instance_url: z.string(),
  id: z.string(),
  token_type: z.string(),
  issued_at: z.string(),
  signature: z.string().optional()
});

export const OAuthErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown()
});

// JWT types
export interface JWTConfig {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly privateKey: string;
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly expiresIn: number;
}

export interface JWTClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly exp: number;
  readonly iat: number;
}

// JWT Zod schemas
export const JWTConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  privateKey: z.string(),
  issuer: z.string(),
  subject: z.string(),
  audience: z.string(),
  expiresIn: z.number(),
  redirectUri: z.string(),
  authorizationEndpoint: z.string(),
  tokenEndpoint: z.string()
});

export const JWTClaimsSchema = z.object({
  iss: z.string(),
  sub: z.string(),
  aud: z.string(),
  exp: z.number(),
  iat: z.number()
});

// Custom jsforce types to avoid complex inheritance issues
export interface SalesforceConnection extends Connection {
  jwt: {
    authorize: (options: { username: string; privateKey: string }) => Promise<{ id: string }>;
  };
}

export interface Opportunity {
  id: string;
  name: string;
  stageName: string;
  amount: number;
  closeDate: Date;
  accountId: string;
}

export interface Account {
  id: string;
  name: string;
  type: string;
  industry: string;
  annualRevenue: number;
  rating: string;
}

export interface Product {
  id: string;
  name: string;
  productCode: string;
  family: string;
  isActive: boolean;
  subscriptionType?: string;
  subscriptionPricing?: string;
}

export interface PricebookEntry {
  id: string;
  productId: string;
  pricebookId: string;
  unitPrice: number;
  useStandardPrice: boolean;
}

export interface Contract {
  id: string;
  accountId: string;
  quoteId: QuoteId;
  startDate: Date;
  endDate?: Date;
  term: number;
  status: string;
}

export interface ApprovalProcess {
  id: string;
  targetObjectId: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  submittedBy: string;
  submittedDate: Date;
  approvers: string[];
}

// Added Address interface
export interface Address {
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
} 