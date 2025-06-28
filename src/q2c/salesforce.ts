import { 
  Quote, 
  QuoteId, 
  QuoteSchema, 
  Either, 
  Left, 
  Right, 
  JWTConfig, 
  SalesforceConnection,
  QuoteLineItem,
  Opportunity,
  Account,
  Product,
  PricebookEntry,
  Contract
} from './types';
import { z } from 'zod';
import Fx from '../index';
import * as jsforce from 'jsforce';
import fs from 'fs';
import path from 'path';
import { Connection } from 'jsforce';
import { sign, decode, JwtHeader, JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';
import { pipe } from 'fp-ts/function';
import * as O from 'fp-ts/Option';
import * as E from 'fp-ts/Either';
import jwt from 'jsonwebtoken';

// API configuration type
export interface SalesforceConfig {
  baseUrl: string;
  apiVersion: string;
  clientId: string;
  clientSecret?: string;  // Optional for JWT flow
  // JWT-specific fields
  privateKey?: string;
  issuer?: string;
  subject?: string;
  audience?: string;
  expiresIn?: number;
}

// Configuration type
export interface SalesforceJWTConfig {
  clientId: string;
  loginUrl?: string;
  privateKey?: string;
  subject: string;
}

// Record type for Salesforce responses
interface SalesforceRecord {
  Id: string;
  Name: string;
  SBQQ__Status__c: string;
  SBQQ__NetAmount__c: number;
  SBQQ__CustomerAmount__c: number;
  CreatedDate: string;
  LastModifiedDate: string;
  SBQQ__Primary__c: boolean;
  SBQQ__Opportunity2__c: string;
  SBQQ__StartDate__c: string | null;
  SBQQ__EndDate__c: string | null;
}

// OAuth response type
interface OAuthResponse {
  access_token: string;
  instance_url: string;
  id: string;
  issued_at: string;
  token_type: string;
}

// API response types
interface QuoteDocumentResponse {
  success: boolean;
  message?: string;
  documentId: string;
}

interface ProcessInstanceResponse {
  success: boolean;
  errors: string[];
}

// Helper functions for Either
export const left = <E, A>(e: E): Either<E, A> => ({ _tag: 'Left', left: e });
export const right = <E, A>(a: A): Either<E, A> => ({ _tag: 'Right', right: a });

// Type guards for Either monad
export const isLeft = <E, A>(either: Either<E, A>): either is Left<E> => either._tag === 'Left';
export const isRight = <E, A>(either: Either<E, A>): either is Right<A> => either._tag === 'Right';

// Pure function to determine Salesforce environment type
export const getSalesforceEnvironment = (instanceUrl: string): 'sandbox' | 'production' => {
  return instanceUrl.includes('.sandbox.') ? 'sandbox' : 'production';
};

// Pure function to determine Salesforce domain from instance URL
export const getSalesforceDomain = (instanceUrl: string): string => {
  return 'login.salesforce.com'; // Always use login.salesforce.com for developer org
};

// Pure function to create OAuth configuration
export const createOAuthConfig = (config: SalesforceConfig): JWTConfig => {
  const domain = getSalesforceDomain(config.baseUrl);
  
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    privateKey: config.privateKey!,
    issuer: config.issuer || config.clientId,
    subject: config.subject!,
    audience: config.audience || `https://${domain}`,
    expiresIn: config.expiresIn || 300
  };
};

// Pure function to create jsforce connection with proper configuration
const createJsforceConnection = (config: SalesforceConfig): SalesforceConnection => {
  const conn = new jsforce.Connection({
    oauth2: {
      clientId: config.clientId,
      loginUrl: config.baseUrl || 'https://login.salesforce.com'
    }
  }) as unknown as SalesforceConnection;
  return conn;
};

// Pure function to read and decode private key
const readEncodedPrivateKey = (): Either<Error, string> => {
  try {
    const encodedKeyPath = path.join(process.cwd(), 'certs', 'encoded_private_key.txt');
    const encodedKey = fs.readFileSync(encodedKeyPath, 'utf8');
    return right(Buffer.from(encodedKey, 'base64').toString('utf8'));
  } catch (error) {
    return left(error as Error);
  }
};

// Pure function to read certificate
const readCertificate = (): Either<Error, string> => {
  try {
    const certPath = path.join(process.cwd(), 'certs', 'server.crt');
    return right(fs.readFileSync(certPath, 'utf8'));
  } catch (error) {
    return left(error as Error);
  }
};

// Pure function to verify certificate
const verifyCertificate = (cert: string, privateKey: string): Either<Error, boolean> => {
  try {
    const verify = crypto.createVerify('SHA256');
    const testData = 'test';
    verify.update(testData);
    
    const signature = crypto.createSign('SHA256')
      .update(testData)
      .sign(privateKey, 'base64');
      
    const isValid = verify.verify(cert, signature, 'base64');
    return right(isValid);
  } catch (error) {
    return left(error as Error);
  }
};

// Pure function to read private key
const readPrivateKey = (): Either<Error, string> => {
  try {
    const keyPath = path.join(process.cwd(), 'certs', 'server.key');
    return right(fs.readFileSync(keyPath, 'utf8'));
  } catch (error) {
    return left(error as Error);
  }
};

// Pure function to create JWT token
const createJWTToken = (config: {
  issuer: string,
  subject: string,
  audience: string,
  privateKey: string
}): Either<Error, string> => {
  try {
    const claim = {
      iss: config.issuer,
      sub: config.subject,
      aud: config.audience,
      exp: Math.floor(Date.now() / 1000) + 180 // 3 minutes expiry
    };
    
    console.log('JWT claims:', claim);
    const token = jwt.sign(claim, config.privateKey, { 
      algorithm: 'RS256'
    });
    
    return right(token);
  } catch (error) {
    return left(error as Error);
  }
};

// Pure function to decode and inspect JWT token
const inspectJWT = (token: string): O.Option<{
  header: JwtHeader,
  payload: JwtPayload,
  hasSignature: boolean
}> => {
  const decoded = decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string' || !decoded.header || !decoded.payload || typeof decoded.payload === 'string') {
    return O.none;
  }
  return O.some({
    header: decoded.header,
    payload: decoded.payload,
    hasSignature: !!decoded.signature
  });
};

// Types
interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

interface JWTClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat?: number;
}

interface OAuthToken {
  access_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature?: string;
}

interface OAuthError {
  code: string;
  message: string;
  details?: unknown;
}

// Zod schema for OAuth token validation
const OAuthTokenSchema = z.object({
  access_token: z.string(),
  instance_url: z.string(),
  id: z.string(),
  token_type: z.string(),
  issued_at: z.string(),
  signature: z.string().optional()
});

// Pure function to read file
const readFile = (filePath: string): Either<Error, string> => {
  try {
    return right(fs.readFileSync(path.join(process.cwd(), filePath), 'utf8'));
  } catch (error) {
    return left(error as Error);
  }
};

// Pure function to generate JWT claims
const generateJWTClaims = (clientId: string, username: string): JWTClaims => {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: clientId.trim(),
    sub: username.trim(),
    aud: 'https://login.salesforce.com',
    exp: now + 30,  // 30 seconds from now
    iat: now
  };
};

// Pure function to get token
export const getToken = async (config: {
  clientId: string;
  loginUrl?: string;
  subject: string;
}): Promise<Either<OAuthError, OAuthToken>> => {
  try {
    const loginUrl = config.loginUrl || 'https://login.salesforce.com';
    
    // Initialize connection with OAuth2 config
    const conn = new Connection({
      oauth2: {
        clientId: config.clientId,
        loginUrl
      }
    });

    // Read private key
    const privateKeyResult = readPrivateKey();
    if (isLeft(privateKeyResult)) {
      return left({
        code: 'FILE_ERROR',
        message: 'Failed to read private key',
        details: privateKeyResult.left
      });
    }
    
    const privateKey = privateKeyResult.right;

    // Create JWT token
    const tokenResult = createJWTToken({
      issuer: config.clientId,
      subject: config.subject,
      audience: loginUrl,
      privateKey
    });

    if (isLeft(tokenResult)) {
      return left({
        code: 'JWT_ERROR',
        message: tokenResult.left.message,
        details: tokenResult.left
      });
    }

    // Authorize using JWT Bearer flow
    const userInfo = await conn.authorize({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: tokenResult.right
    });

    console.log('Access token ➜', conn.accessToken);

    return right({
      access_token: conn.accessToken!,
      instance_url: conn.instanceUrl!,
      id: userInfo.id,
      token_type: 'Bearer',
      issued_at: new Date().toISOString(),
      signature: ''
    });
  } catch (error) {
    const err = error as Error;
    console.error('Authentication error:', err);
    return left({
      code: 'AUTH_ERROR',
      message: err.message || 'Authentication failed',
      details: err
    });
  }
};

// Pure function to create Salesforce connection
export const createConnection = (token: OAuthToken): Connection => {
  return new Connection({
    instanceUrl: token.instance_url,
    accessToken: token.access_token
  });
};

// Pure function to get authorization URL
export const getAuthorizationUrl = (config: OAuthConfig): string => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    // Add required scopes for CPQ API access
    scope: 'api refresh_token web full'
  });

  // Add PKCE if code_challenge is present
  if (process.env.SALESFORCE_CODE_CHALLENGE) {
    params.append('code_challenge', process.env.SALESFORCE_CODE_CHALLENGE);
    params.append('code_challenge_method', 'S256');
  }

  const finalUrl = `${config.authorizationEndpoint}?${params.toString()}`;
  console.log('Generated Salesforce Auth URL:', finalUrl);
  return finalUrl;
};

// Pure function to filter out undefined values from params
const filterUndefinedValues = (params: Record<string, string | undefined>): Record<string, string> => 
  Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== undefined)) as Record<string, string>;

// Pure function to create params for token request
const createTokenParams = (params: Record<string, string>): URLSearchParams => 
  new URLSearchParams(Object.entries(params));

// Pure function to exchange code for token
export const exchangeCodeForToken = async (
  config: OAuthConfig,
  code: string,
  codeVerifier?: string,
  retryAttempts = 5
): Promise<Either<OAuthError, OAuthToken>> => {
  const makeRequest = async (attempt: number = 1): Promise<Either<OAuthError, OAuthToken>> => {
    try {
      const params = new URLSearchParams(filterUndefinedValues({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code
      }));

      // Add PKCE code verifier if provided
      if (codeVerifier) {
        params.append('code_verifier', codeVerifier);
      }

      const response = await fetch(config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: params
      });

      const data = await response.json();

      if (!response.ok) {
        // If we get a retry-able error and haven't exceeded attempts, retry
        if (attempt < retryAttempts && (
          data.error === 'invalid_grant' || 
          data.error === 'server_error' ||
          response.status >= 500
        )) {
          console.log(`Retrying OAuth token exchange. Attempt ${attempt} of ${retryAttempts}`);
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          return makeRequest(attempt + 1);
        }
        
        return left({
          code: data.error || 'OAUTH_ERROR',
          message: data.error_description || 'Failed to obtain OAuth token',
          details: data
        });
      }

      return right(OAuthTokenSchema.parse(data));
    } catch (error) {
      // If we haven't exceeded attempts, retry on network errors
      if (attempt < retryAttempts && error instanceof Error && (
        error.message.includes('network') ||
        error.message.includes('timeout') ||
        error.message.includes('connection')
      )) {
        console.log(`Retrying OAuth token exchange due to network error. Attempt ${attempt} of ${retryAttempts}`);
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        return makeRequest(attempt + 1);
      }
      
      return left({
        code: 'OAUTH_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        details: error
      });
    }
  };

  return makeRequest();
};

// Pure function to refresh token
export const refreshToken = async (
  config: OAuthConfig,
  refreshToken: string,
  retryAttempts = 5
): Promise<Either<OAuthError, OAuthToken>> => {
  const makeRequest = async (attempt: number = 1): Promise<Either<OAuthError, OAuthToken>> => {
    try {
      const params = createTokenParams({
        grant_type: 'refresh_token',
        client_id: config.clientId,
        refresh_token: refreshToken
      });

      const response = await fetch(config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: params
      });

      const data = await response.json();

      if (!response.ok) {
        // If we get a retry-able error and haven't exceeded attempts, retry
        if (attempt < retryAttempts && (
          data.error === 'invalid_grant' || 
          data.error === 'server_error' ||
          response.status >= 500
        )) {
          console.log(`Retrying token refresh. Attempt ${attempt} of ${retryAttempts}`);
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          return makeRequest(attempt + 1);
        }
        
        return left({
          code: data.error || 'OAUTH_ERROR',
          message: data.error_description || 'Failed to refresh token',
          details: data
        });
      }

      return right(OAuthTokenSchema.parse(data));
    } catch (error) {
      // If we haven't exceeded attempts, retry on network errors
      if (attempt < retryAttempts && error instanceof Error && (
        error.message.includes('network') ||
        error.message.includes('timeout') ||
        error.message.includes('connection')
      )) {
        console.log(`Retrying token refresh due to network error. Attempt ${attempt} of ${retryAttempts}`);
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        return makeRequest(attempt + 1);
      }
      
      return left({
        code: 'OAUTH_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        details: error
      });
    }
  };

  return makeRequest();
};

// Pure function to create API headers with OAuth token
const createHeaders = (token: OAuthToken): Record<string, string> => ({
  'Authorization': `Bearer ${token.access_token}`,
  'Content-Type': 'application/json'
});

// Pure function to build API URL
const buildUrl = (instanceUrl: string, apiVersion: string, path: string): string => {
  const version = apiVersion.replace(/^v/, '');
  return `${instanceUrl}/services/data/v${version}${path}`;
};

// Simplified API operations
export const SalesforceAPI = {
  // List quotes
  listQuotes: async (conn: Connection): Promise<Quote[]> => {
    const result = await conn.query<any>(
      "SELECT Id, Name, SBQQ__Status__c, SBQQ__NetAmount__c, SBQQ__CustomerAmount__c, " +
      "CreatedDate, LastModifiedDate, SBQQ__Primary__c, SBQQ__Opportunity2__c, " +
      "SBQQ__StartDate__c, SBQQ__EndDate__c, " +
      "SBQQ__BillingStreet__c, SBQQ__BillingCity__c, SBQQ__BillingState__c, SBQQ__BillingPostalCode__c, SBQQ__BillingCountry__c, " +
      "SBQQ__ShippingStreet__c, SBQQ__ShippingCity__c, SBQQ__ShippingState__c, SBQQ__ShippingPostalCode__c, SBQQ__ShippingCountry__c " +
      "FROM SBQQ__Quote__c " +
      "ORDER BY CreatedDate DESC " +
      "LIMIT 10"
    );

    return result.records.map(record => ({
      id: record.Id,
      name: record.Name,
      amount: record.SBQQ__NetAmount__c || record.SBQQ__CustomerAmount__c || 0,
      status: record.SBQQ__Status__c,
      createdAt: new Date(record.CreatedDate),
      lastModifiedAt: new Date(record.LastModifiedDate),
      lineItems: [],
      billingAddress: {
        street: record.SBQQ__BillingStreet__c || null,
        city: record.SBQQ__BillingCity__c || null,
        state: record.SBQQ__BillingState__c || null,
        postalCode: record.SBQQ__BillingPostalCode__c || null,
        country: record.SBQQ__BillingCountry__c || null,
      },
      shippingAddress: {
        street: record.SBQQ__ShippingStreet__c || null,
        city: record.SBQQ__ShippingCity__c || null,
        state: record.SBQQ__ShippingState__c || null,
        postalCode: record.SBQQ__ShippingPostalCode__c || null,
        country: record.SBQQ__ShippingCountry__c || null,
      },
      metadata: {
        isPrimary: record.SBQQ__Primary__c,
        opportunityId: record.SBQQ__Opportunity2__c,
        startDate: record.SBQQ__StartDate__c ? new Date(record.SBQQ__StartDate__c) : null,
        endDate: record.SBQQ__EndDate__c ? new Date(record.SBQQ__EndDate__c) : null
      }
    }));
  },

  // Fetch single quote
  fetchQuote: async (conn: Connection, quoteId: QuoteId): Promise<Quote> => {
    const result = await conn.query<any>(
      `SELECT Id, Name, SBQQ__Status__c, SBQQ__NetAmount__c, SBQQ__CustomerAmount__c, ` +
      `CreatedDate, LastModifiedDate, SBQQ__Primary__c, SBQQ__Opportunity2__c, ` +
      `SBQQ__StartDate__c, SBQQ__EndDate__c, ` +
      `SBQQ__BillingStreet__c, SBQQ__BillingCity__c, SBQQ__BillingState__c, SBQQ__BillingPostalCode__c, SBQQ__BillingCountry__c, ` +
      `SBQQ__ShippingStreet__c, SBQQ__ShippingCity__c, SBQQ__ShippingState__c, SBQQ__ShippingPostalCode__c, SBQQ__ShippingCountry__c ` +
      `FROM SBQQ__Quote__c ` +
      `WHERE Id = '${quoteId}'`
    );

    if (!result.records || result.records.length === 0) {
      throw new Error(`Quote with ID ${quoteId} not found`);
    }

    const record = result.records[0];
    const quoteData: Quote = {
      id: record.Id,
      name: record.Name,
      amount: record.SBQQ__NetAmount__c || record.SBQQ__CustomerAmount__c || 0,
      status: record.SBQQ__Status__c,
      createdAt: new Date(record.CreatedDate),
      lastModifiedAt: new Date(record.LastModifiedDate),
      lineItems: [],
      billingAddress: {
        street: record.SBQQ__BillingStreet__c || null,
        city: record.SBQQ__BillingCity__c || null,
        state: record.SBQQ__BillingState__c || null,
        postalCode: record.SBQQ__BillingPostalCode__c || null,
        country: record.SBQQ__BillingCountry__c || null,
      },
      shippingAddress: {
        street: record.SBQQ__ShippingStreet__c || null,
        city: record.SBQQ__ShippingCity__c || null,
        state: record.SBQQ__ShippingState__c || null,
        postalCode: record.SBQQ__ShippingPostalCode__c || null,
        country: record.SBQQ__ShippingCountry__c || null,
      },
      metadata: {
        isPrimary: record.SBQQ__Primary__c,
        opportunityId: record.SBQQ__Opportunity2__c,
        startDate: record.SBQQ__StartDate__c ? new Date(record.SBQQ__StartDate__c) : null,
        endDate: record.SBQQ__EndDate__c ? new Date(record.SBQQ__EndDate__c) : null,
        // Removed address from metadata as it's now top-level
      }
    };

    // If the quote doesn't have direct address info, try to get from Account via Opportunity
    const needsBillingAddress = !quoteData.billingAddress?.street && !quoteData.billingAddress?.city;
    const needsShippingAddress = !quoteData.shippingAddress?.street && !quoteData.shippingAddress?.city;

    if (record.SBQQ__Opportunity2__c && (needsBillingAddress || needsShippingAddress)) {
      try {
        const oppResult = await conn.query<any>(
          `SELECT Id, AccountId FROM Opportunity WHERE Id = '${record.SBQQ__Opportunity2__c}'`
        );

        if (oppResult.records && oppResult.records.length > 0 && oppResult.records[0].AccountId) {
          const accountResult = await conn.query<any>(
            `SELECT Id, BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry, 
                    ShippingStreet, ShippingCity, ShippingState, ShippingPostalCode, ShippingCountry 
             FROM Account WHERE Id = '${oppResult.records[0].AccountId}'`
          );

          if (accountResult.records && accountResult.records.length > 0) {
            const account = accountResult.records[0];
            if (needsBillingAddress) {
              quoteData.billingAddress = {
                street: account.BillingStreet || null,
                city: account.BillingCity || null,
                state: account.BillingState || null,
                postalCode: account.BillingPostalCode || null,
                country: account.BillingCountry || null,
              };
            }
            if (needsShippingAddress) {
              quoteData.shippingAddress = {
                street: account.ShippingStreet || null,
                city: account.ShippingCity || null,
                state: account.ShippingState || null,
                postalCode: account.ShippingPostalCode || null,
                country: account.ShippingCountry || null,
              };
            }
          }
        }
      } catch (error) {
        console.warn(`Could not fetch supplemental address information for quote ${quoteId} from Account:`, error);
      }
    }

    return quoteData;
  },

  // Update quote status
  updateQuoteStatus: async (conn: Connection, quoteId: QuoteId, status: string): Promise<void> => {
    const result = await conn.sobject('SBQQ__Quote__c').update({
      Id: quoteId,
      SBQQ__Status__c: status
    });

    if (!result.success) {
      throw new Error(`Failed to update quote status: ${result.errors.join(', ')}`);
    }
  },

  // Quote Line Items
  fetchQuoteLineItems: async (conn: Connection, quoteId: QuoteId): Promise<QuoteLineItem[]> => {
    const result = await conn.query<any>(
      `SELECT Id, SBQQ__Quote__c, SBQQ__Product__c, SBQQ__Product__r.Name, SBQQ__Quantity__c, ` +
      `SBQQ__ListPrice__c, SBQQ__NetPrice__c, SBQQ__SubscriptionTerm__c ` +
      `FROM SBQQ__QuoteLine__c WHERE SBQQ__Quote__c = '${quoteId}'`
    );

    return result.records.map(record => ({
      id: record.Id,
      quoteId: record.SBQQ__Quote__c,
      productId: record.SBQQ__Product__c,
      productName: record.SBQQ__Product__r?.Name,
      quantity: record.SBQQ__Quantity__c,
      listPrice: record.SBQQ__ListPrice__c,
      netPrice: record.SBQQ__NetPrice__c,
      subscriptionTerm: record.SBQQ__SubscriptionTerm__c,
      unitPrice: record.SBQQ__ListPrice__c,
      totalPrice: record.SBQQ__NetPrice__c
    }));
  },

  // Update quote line item quantity
  updateQuoteLineItem: async (conn: Connection, quoteId: QuoteId, productName: string, newQuantity: number): Promise<boolean> => {
    try {
      // First, fetch both line items and their product names
      const lineItems = await SalesforceAPI.fetchQuoteLineItems(conn, quoteId);

      // Debug log the line items
      console.log(`Found ${lineItems.length} line items for quote ${quoteId}`);
      lineItems.forEach((item, i) => {
        console.log(`Line item ${i+1}: ID=${item.id}, Product=${item.productId}, Quantity=${item.quantity}`);
      });
      
      // First try to get product names for each line item
      interface EnhancedLineItem extends QuoteLineItem {
        productName: string;
      }
      
      let lineItemWithProductNames: EnhancedLineItem[] = [];
      try {
        // Execute a query to get the product names
        const productIds = lineItems.map(item => `'${item.productId}'`).join(',');
        if (productIds.length > 0) {
          const productQuery = await conn.query<any>(
            `SELECT Id, Name FROM Product2 WHERE Id IN (${productIds})`
          );
          
          // Map product IDs to names
          const productMap = new Map();
          productQuery.records.forEach(record => {
            productMap.set(record.Id, record.Name);
          });
          
          // Enhance line items with product names
          lineItemWithProductNames = lineItems.map(item => ({
            ...item,
            productName: productMap.get(item.productId) || item.productId
          }));
          
          console.log('Enhanced line items with product names:', 
            lineItemWithProductNames.map(item => `${item.productName} (${item.productId})`));
        }
      } catch (productQueryError) {
        console.warn('Could not fetch product names:', productQueryError);
        // Continue with just the line items we have
        lineItemWithProductNames = lineItems.map(item => ({
          ...item,
          productName: item.productId
        }));
      }
      
      // Find the matching line item using a more flexible matching approach
      // Try different ways of matching - by product name, line item ID, or partial matches
      const targetLineItem = lineItemWithProductNames.find(item => {
        // Check for exact product name match (case insensitive)
        if (item.productName && item.productName.toLowerCase() === productName.toLowerCase()) {
          return true;
        }
        
        // Check for partial product name match
        if (item.productName && 
            (item.productName.toLowerCase().includes(productName.toLowerCase()) || 
             productName.toLowerCase().includes(item.productName.toLowerCase()))) {
          return true;
        }
        
        // Check for product ID match (might be QL-XXXXXX format)
        if (item.id && item.id.toLowerCase().includes(productName.toLowerCase())) {
          return true;
        }
        
        // Last resort - check for any overlap in strings
        return item.productId && 
               (item.productId.toLowerCase().includes(productName.toLowerCase()) || 
                productName.toLowerCase().includes(item.productId.toLowerCase()));
      });
      
      // If no match found, try a direct SOQL query matching on product name
      if (!targetLineItem && lineItems.length > 0) {
        try {
          console.log(`Trying direct SOQL query to find line item for product '${productName}'`);
          const productSearchQuery = await conn.query<any>(
            `SELECT Id, SBQQ__Product__r.Name, SBQQ__Quantity__c, SBQQ__ListPrice__c, SBQQ__NetPrice__c 
             FROM SBQQ__QuoteLine__c 
             WHERE SBQQ__Quote__c = '${quoteId}' 
             AND SBQQ__Product__r.Name LIKE '%${productName.replace(/'/g, "\\'")}%'`
          );
          
          if (productSearchQuery.records && productSearchQuery.records.length > 0) {
            console.log(`Found match via SOQL: ${productSearchQuery.records[0].SBQQ__Product__r.Name}`);
            
            // Use first matching record
            const matchedRecord = productSearchQuery.records[0];
            const lineItem = {
              id: matchedRecord.Id,
              quoteId: quoteId,
              productId: matchedRecord.SBQQ__Product__r.Id || '',
              productName: matchedRecord.SBQQ__Product__r.Name || '',
              quantity: matchedRecord.SBQQ__Quantity__c,
              unitPrice: matchedRecord.SBQQ__ListPrice__c,
              totalPrice: matchedRecord.SBQQ__NetPrice__c
            };
            
            // Update the line item quantity
            const result = await conn.sobject('SBQQ__QuoteLine__c').update({
              Id: lineItem.id,
              SBQQ__Quantity__c: newQuantity
            });
            
            if (!result.success) {
              console.error(`Failed to update quote line item: ${result.errors?.join(', ')}`);
              return false;
            }
            
            console.log(`Successfully updated quantity for product '${lineItem.productName}' to ${newQuantity}`);
            return true;
          }
        } catch (searchError) {
          console.error('Error in direct search query:', searchError);
        }
      }
      
      if (!targetLineItem) {
        // If all else fails, just try updating the first line item if there's only one
        if (lineItems.length === 1) {
          console.log(`No exact match found, but quote has only one line item. Updating it.`);
          const lineItem = lineItems[0];
          
          // Update the line item quantity
          const result = await conn.sobject('SBQQ__QuoteLine__c').update({
            Id: lineItem.id,
            SBQQ__Quantity__c: newQuantity
          });
          
          if (!result.success) {
            console.error(`Failed to update quote line item: ${result.errors?.join(', ')}`);
            return false;
          }
          
          console.log(`Successfully updated quantity for the only line item to ${newQuantity}`);
          return true;
        }
        
        console.error(`No line item found matching product "${productName}" in quote ${quoteId}`);
        return false;
      }
      
      // Calculate new total price
      const unitPrice = targetLineItem.unitPrice || 0;
      const newTotalPrice = unitPrice * newQuantity;
      
      console.log(`Updating line item ${targetLineItem.id} (${targetLineItem.productName}) from quantity ${targetLineItem.quantity} to ${newQuantity}`);
      
      // Update the line item quantity
      const result = await conn.sobject('SBQQ__QuoteLine__c').update({
        Id: targetLineItem.id,
        SBQQ__Quantity__c: newQuantity
      });
      
      if (!result.success) {
        console.error(`Failed to update quote line item: ${result.errors?.join(', ')}`);
        return false;
      }
      
      console.log(`Successfully updated quantity to ${newQuantity}`);
      
      // Recalculate quote if needed - use try/catch with fallback options
      try {
        // First attempt: Try the standard SBQQ Apex REST endpoint
        try {
          await conn.apex.post('/services/apexrest/SBQQ/CalculateQuote', {
            quoteId: quoteId
          });
          console.log('Successfully recalculated quote via SBQQ API');
        } catch (primaryError) {
          console.log('Primary recalculation method failed, trying alternatives...');
          
          // Second attempt: Try updating a field on the quote to trigger formula recalculation
          try {
            // Get current quote
            const quoteData = await SalesforceAPI.fetchQuote(conn, quoteId);
            
            // Update the quote with same status to trigger recalculation
            await conn.sobject('SBQQ__Quote__c').update({
              Id: quoteId,
              SBQQ__Status__c: quoteData.status // Use same status to not change anything important
            });
            console.log('Successfully triggered quote recalculation via update');
          } catch (secondaryError) {
            // If both methods fail, log the error but don't fail the operation
            console.warn(`Quote recalculation warning: Unable to recalculate totals automatically. 
                         The line item was updated successfully, but totals may need manual refresh.`);
          }
        }
      } catch (recalcError) {
        // Even if recalculation fails completely, the line item update was still successful
        console.warn(`Quote recalculation warning: ${recalcError}`);
        console.log('Line item quantity was updated successfully, but quote totals may need to be refreshed manually');
      }
      
      return true;
    } catch (error) {
      console.error(`Error updating quote line item: ${error}`);
      return false;
    }
  },

  // Remove a specific quote line item
  removeQuoteLineItem: async (conn: Connection, quoteId: QuoteId, productNameOrIdToRemove: string): Promise<{ success: boolean; message: string }> => {
    try {
      console.log(`Attempting to remove line item: ${productNameOrIdToRemove} from quote ${quoteId}`);
      // Line items will now include productName thanks to the previous change in fetchQuoteLineItems
      const lineItems = await SalesforceAPI.fetchQuoteLineItems(conn, quoteId);

      if (lineItems.length === 0) {
        return { success: false, message: "No line items found on the quote." };
      }
      
      let targetLineItemId: string | null = null;
      const lowerProductNameOrId = productNameOrIdToRemove.toLowerCase();

      // First, try exact match on product name (if available) or product ID
      const foundItemExact = lineItems.find(item =>
        (item.productName && item.productName.toLowerCase() === lowerProductNameOrId) ||
        item.productId.toLowerCase() === lowerProductNameOrId
      );

      if (foundItemExact) {
        targetLineItemId = foundItemExact.id;
        console.log(`Found line item by exact match: ${foundItemExact.productName || foundItemExact.productId} (ID: ${targetLineItemId})`);
      } else {
        // If no exact match, try partial match on product name
        console.warn(`No exact match for line item '${productNameOrIdToRemove}'. Trying partial name match.`);
        const possibleTargets = lineItems.filter(item =>
          item.productName && item.productName.toLowerCase().includes(lowerProductNameOrId)
        );

        if (possibleTargets.length === 1) {
          targetLineItemId = possibleTargets[0].id;
          console.log(`Found unique item to remove by partial name match: ${possibleTargets[0].productName} (ID: ${targetLineItemId})`);
        } else if (possibleTargets.length > 1) {
          const matchedNames = possibleTargets.map(p => p.productName).filter(Boolean).join(', ');
          return { success: false, message: `Multiple line items match '${productNameOrIdToRemove}' by name (${matchedNames}). Please be more specific or use the Product ID.` };
        }
      }

      if (!targetLineItemId) {
        return { success: false, message: `Line item '${productNameOrIdToRemove}' not found on quote ${quoteId}.` };
      }

      console.log(`Found line item ID to remove: ${targetLineItemId}`);
      const result = await conn.sobject('SBQQ__QuoteLine__c').destroy(targetLineItemId);

      if (result.success) {
        console.log(`Successfully removed line item ${targetLineItemId} from quote ${quoteId}`);
        // Optionally, trigger quote recalculation here if CPQ doesn't do it automatically on line removal
        try {
          await conn.apex.post('/services/apexrest/SBQQ/CalculateQuote', { quoteId });
          console.log('Successfully triggered quote recalculation after line item removal.');
        } catch (recalcError) {
          console.warn('Quote recalculation after line item removal failed (this might be okay if automatic): ', recalcError);
        }
        return { success: true, message: `Successfully removed line item '${productNameOrIdToRemove}'.` };
      } else {
        const errorMsg = result.errors && result.errors.length > 0 ? result.errors.join(', ') : 'Unknown error';
        console.error(`Failed to remove line item ${targetLineItemId}: ${errorMsg}`);
        return { success: false, message: `Failed to remove line item: ${errorMsg}` };
      }
    } catch (error) {
      console.error(`Error in removeQuoteLineItem for quote ${quoteId}:`, error);
      return { success: false, message: `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}` };
    }
  },

  // Opportunity Integration
  fetchRelatedOpportunity: async (conn: Connection, quoteId: QuoteId): Promise<Opportunity> => {
    const result = await conn.query<any>(
      `SELECT Id, Name, StageName, Amount, CloseDate, AccountId ` +
      `FROM Opportunity ` +
      `WHERE Id IN (SELECT SBQQ__Opportunity2__c FROM SBQQ__Quote__c WHERE Id = '${quoteId}')`
    );

    if (!result.records || result.records.length === 0) {
      throw new Error(`No opportunity found for quote ${quoteId}`);
    }

    const record = result.records[0];
    return {
      id: record.Id,
      name: record.Name,
      stageName: record.StageName,
      amount: record.Amount,
      closeDate: new Date(record.CloseDate),
      accountId: record.AccountId
    };
  },

  // Account Information
  fetchAccountDetails: async (conn: Connection, accountId: string): Promise<Account> => {
    const result = await conn.query<any>(
      `SELECT Id, Name, Type, Industry, AnnualRevenue, Rating ` +
      `FROM Account WHERE Id = '${accountId}'`
    );

    if (!result.records || result.records.length === 0) {
      throw new Error(`Account ${accountId} not found`);
    }

    const record = result.records[0];
    return {
      id: record.Id,
      name: record.Name,
      type: record.Type,
      industry: record.Industry,
      annualRevenue: record.AnnualRevenue,
      rating: record.Rating
    };
  },

  // Product Catalog
  fetchProducts: async (conn: Connection): Promise<Product[]> => {
    const result = await conn.query<any>(
      `SELECT Id, Name, ProductCode, Family, IsActive, ` +
      `SBQQ__SubscriptionType__c, SBQQ__SubscriptionPricing__c ` +
      `FROM Product2 WHERE IsActive = true`
    );

    return result.records.map(record => ({
      id: record.Id,
      name: record.Name,
      productCode: record.ProductCode,
      family: record.Family,
      isActive: record.IsActive,
      subscriptionType: record.SBQQ__SubscriptionType__c,
      subscriptionPricing: record.SBQQ__SubscriptionPricing__c
    }));
  },

  // Price Books
  fetchPriceBookEntries: async (conn: Connection, productId: string): Promise<PricebookEntry[]> => {
    const result = await conn.query<any>(
      `SELECT Id, UnitPrice, Pricebook2Id, Product2Id, UseStandardPrice ` +
      `FROM PricebookEntry WHERE Product2Id = '${productId}'`
    );

    return result.records.map(record => ({
      id: record.Id,
      productId: record.Product2Id,
      pricebookId: record.Pricebook2Id,
      unitPrice: record.UnitPrice,
      useStandardPrice: record.UseStandardPrice
    }));
  },

  // Contract Management
  // ... existing code ...
};