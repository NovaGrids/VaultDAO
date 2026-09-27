export interface JaegerConfig {
  serviceName: string;
  enabled: boolean;
  agentHost: string;
  agentPort: number;
  collectorEndpoint?: string;
  samplerType: 'const' | 'probabilistic' | 'ratelimiting' | 'remote';
  samplerParam: number;
  logSpans: boolean;
  reporterLoggerType: 'console' | 'file';
}

export function getJaegerConfig(): JaegerConfig {
  const enabled = process.env.JAEGER_ENABLED !== 'false';

  return {
    serviceName: process.env.SERVICE_NAME || 'vaultdao-backend',
    enabled,
    agentHost: process.env.JAEGER_AGENT_HOST || 'localhost',
    agentPort: parseInt(process.env.JAEGER_AGENT_PORT || '6831', 10),
    collectorEndpoint:
      process.env.JAEGER_COLLECTOR_ENDPOINT ||
      'http://localhost:14268/api/traces',
    samplerType: (process.env.JAEGER_SAMPLER_TYPE as any) || 'const',
    samplerParam: parseInt(process.env.JAEGER_SAMPLER_PARAM || '1', 10),
    logSpans: process.env.JAEGER_LOG_SPANS === 'true',
    reporterLoggerType: 'console',
  };
}

/**
 * Validate Jaeger configuration
 */
export function validateJaegerConfig(config: JaegerConfig): void {
  if (!config.enabled) {
    console.warn('Jaeger tracing is disabled');
    return;
  }

  if (!config.serviceName) {
    throw new Error('SERVICE_NAME environment variable is required');
  }

  if (!config.agentHost) {
    throw new Error('JAEGER_AGENT_HOST environment variable is required');
  }

  if (config.samplerParam < 0 || config.samplerParam > 1) {
    throw new Error('JAEGER_SAMPLER_PARAM must be between 0 and 1');
  }

  console.log(
    `Jaeger configuration validated: ${config.serviceName} @ ${config.agentHost}:${config.agentPort}`,
  );
}
