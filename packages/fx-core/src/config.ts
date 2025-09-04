import { FxConfig } from './types';

/**
 * Environment-aware configuration management
 * Supports environment variables and runtime configuration
 */

// Create configuration from environment variables
export const createConfigFromEnv = (): FxConfig => ({
  enableLogging: process.env.FX_LOGGING === 'true' ||
                process.env.NODE_ENV === 'development',
  maxRetries: parseInt(process.env.FX_MAX_RETRIES || '3', 10),
  retryDelay: parseInt(process.env.FX_RETRY_DELAY || '1000', 10),
  logLevel: (process.env.FX_LOG_LEVEL as FxConfig['logLevel']) || 'info'
});

// Default configuration
const DEFAULT_CONFIG: FxConfig = createConfigFromEnv();

// Current configuration
let currentConfig: FxConfig = { ...DEFAULT_CONFIG };

/**
 * Configure the Fx framework
 */
export const configure = (config: Partial<FxConfig>): void => {
  currentConfig = { ...currentConfig, ...config };
};

/**
 * Get current configuration
 */
export const getConfig = (): FxConfig => {
  return { ...currentConfig };
};

/**
 * Reset to default configuration
 */
export const resetConfig = (): void => {
  currentConfig = { ...DEFAULT_CONFIG };
};

/**
 * Validate configuration
 */
export const validateConfig = (config: FxConfig): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (config.maxRetries !== undefined && config.maxRetries < 0) {
    errors.push('maxRetries must be non-negative');
  }

  if (config.retryDelay !== undefined && config.retryDelay < 0) {
    errors.push('retryDelay must be non-negative');
  }

  if (config.logLevel && !['debug', 'info', 'warn', 'error'].includes(config.logLevel)) {
    errors.push('logLevel must be one of: debug, info, warn, error');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

// Auto-initialize on module load
if (typeof process !== 'undefined' && process.env) {
  const envConfig = createConfigFromEnv();
  const validation = validateConfig(envConfig);

  if (!validation.valid) {
    console.warn('Invalid configuration from environment:', validation.errors);
    console.warn('Using default configuration');
  } else {
    currentConfig = envConfig;
  }
}