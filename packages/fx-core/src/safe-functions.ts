/**
 * Safe Function Builder
 * Generic utilities for creating safe functions that return Either
 */

import { Either } from './types';

/**
 * Create a safe function that wraps a potentially throwing function
 */
export const safe = <T, R>(
  fn: (input: T) => R,
  errorMapper?: (error: unknown) => Error
): (input: T) => Either<Error, R> => {
  return (input: T): Either<Error, R> => {
    try {
      const result = fn(input);
      return Either.right(result);
    } catch (error) {
      const mappedError = errorMapper 
        ? errorMapper(error)
        : error instanceof Error 
          ? error 
          : new Error(String(error));
      return Either.left(mappedError);
    }
  };
};

/**
 * Create a safe async function
 */
export const safeAsync = <T, R>(
  fn: (input: T) => Promise<R>,
  errorMapper?: (error: unknown) => Error
): (input: T) => Promise<Either<Error, R>> => {
  return async (input: T): Promise<Either<Error, R>> => {
    try {
      const result = await fn(input);
      return Either.right(result);
    } catch (error) {
      const mappedError = errorMapper 
        ? errorMapper(error)
        : error instanceof Error 
          ? error 
          : new Error(String(error));
      return Either.left(mappedError);
    }
  };
};

/**
 * Create a safe function with custom validation
 */
export const safeWithValidation = <T, R>(
  fn: (input: T) => R,
  validator: (input: T) => Either<Error, T>,
  errorMapper?: (error: unknown) => Error
): (input: T) => Either<Error, R> => {
  return (input: T): Either<Error, R> => {
    const validationResult = validator(input);
    
    return Either.fold(
      validationResult,
      (validationError) => Either.left(validationError),
      (validatedInput) => {
        try {
          const result = fn(validatedInput);
          return Either.right(result);
        } catch (error) {
          const mappedError = errorMapper 
            ? errorMapper(error)
            : error instanceof Error 
              ? error 
              : new Error(String(error));
          return Either.left(mappedError);
        }
      }
    );
  };
};

/**
 * Create a safe function that handles specific error codes
 */
export const safeWithErrorHandling = <T, R>(
  fn: (input: T) => R,
  errorHandlers: Record<string | number, (error: unknown) => Either<Error, R>>,
  defaultErrorMapper?: (error: unknown) => Error
): (input: T) => Either<Error, R> => {
  return (input: T): Either<Error, R> => {
    try {
      const result = fn(input);
      return Either.right(result);
    } catch (error) {
      const errorCode = (error as any)?.code;
      const handler = errorHandlers[errorCode];
      
      if (handler) {
        return handler(error);
      }
      
      const mappedError = defaultErrorMapper 
        ? defaultErrorMapper(error)
        : error instanceof Error 
          ? error 
          : new Error(String(error));
      return Either.left(mappedError);
    }
  };
};
