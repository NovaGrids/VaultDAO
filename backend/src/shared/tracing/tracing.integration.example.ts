/**
 * Integration example showing how to use distributed tracing
 * in VaultDAO backend components
 */

import express, { Express, Request, Response } from 'express';
import {
  initializeJaegerTracing,
  tracingMiddleware,
  TracerUtil,
  getTracer,
} from './index';

// ============================================================================
// 1. APPLICATION INITIALIZATION
// ============================================================================

export function createAppWithTracing(): Express {
  // Initialize Jaeger tracing before creating app
  initializeJaegerTracing();

  const app = express();

  // Add tracing middleware early
  app.use(tracingMiddleware());

  // ... rest of middleware setup
  return app;
}

// ============================================================================
// 2. TRACING API ENDPOINTS
// ============================================================================

/**
 * Example API endpoint with automatic tracing
 * The tracingMiddleware() automatically:
 * - Creates span for each request
 * - Extracts trace context from headers
 * - Tags with HTTP method/status/errors
 * - Logs to response headers
 */
export async function simulateContractHandler(req: Request, res: Response) {
  // Access trace context from request
  const traceId = req.traceId;
  const parentSpan = req.span;

  try {
    // Trace the contract simulation
    const result = await TracerUtil.traceAsync(
      'contract.simulation',
      async (span) => {
        span.setTag('contract.address', req.body.contractAddress);
        span.setTag('method.name', req.body.methodName);

        // Child span for data validation
        const validationResult = await TracerUtil.traceAsync(
          'validation.contract_params',
          async (validSpan) => {
            validSpan.setTag('params.count', req.body.params?.length || 0);
            // Validate parameters
            return validateContractParams(req.body.params);
          },
          span
        );

        // Child span for contract call
        const callResult = await TracerUtil.traceAsync(
          'rpc.eth_call',
          async (rpcSpan) => {
            rpcSpan.setTag('rpc.provider', 'infura');
            // Execute contract call
            return await executeContractCall(req.body);
          },
          span
        );

        return callResult;
      },
      parentSpan
    );

    res.json({ success: true, result, traceId });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
      traceId,
    });
  }
}

// ============================================================================
// 3. TRACING DATABASE OPERATIONS
// ============================================================================

export async function getContractMetadataFromDb(
  contractAddress: string,
  parentSpan: any
) {
  return await TracerUtil.traceAsync(
    'database.query.contract_metadata',
    async (span) => {
      span.setTag('query.type', 'SELECT');
      span.setTag('table', 'contracts');
      span.setTag('contract.address', contractAddress);

      const startTime = Date.now();
      try {
        // Simulate database query
        const result = await queryDatabase(
          `SELECT * FROM contracts WHERE address = $1`,
          [contractAddress]
        );

        const duration = Date.now() - startTime;
        span.setTag('query.duration_ms', duration);
        span.setTag('rows.returned', result.length);

        return result;
      } catch (error) {
        span.setTag('error', true);
        span.log({
          event: 'error',
          message: (error as Error).message,
          'query.error.type': (error as any).code,
        });
        throw error;
      }
    },
    parentSpan
  );
}

// ============================================================================
// 4. TRACING EVENT PROCESSING
// ============================================================================

export async function processBlockEvent(
  blockNumber: number,
  transactions: any[],
  traceContext: any
) {
  return await TracerUtil.traceAsync(
    'event.process.block',
    async (blockSpan) => {
      blockSpan.setTag('block.number', blockNumber);
      blockSpan.setTag('transactions.count', transactions.length);
      blockSpan.setBaggageItem('block.number', blockNumber.toString());

      const processedTxs = [];

      for (const tx of transactions) {
        const txResult = await TracerUtil.traceAsync(
          'event.process.transaction',
          async (txSpan) => {
            txSpan.setTag('tx.hash', tx.hash);
            txSpan.setTag('tx.to', tx.to);
            txSpan.setTag('tx.from', tx.from);

            // Log transaction processing event
            TracerUtil.logEvent(txSpan, 'tx.started', {
              timestamp: Date.now(),
              gasUsed: tx.gas,
            });

            try {
              const result = await processTransaction(tx);

              TracerUtil.logEvent(txSpan, 'tx.completed', {
                status: 'success',
                eventsEmitted: result.events.length,
              });

              return result;
            } catch (error) {
              TracerUtil.logEvent(txSpan, 'tx.failed', {
                error: (error as Error).message,
              });
              throw error;
            }
          },
          blockSpan
        );

        processedTxs.push(txResult);
      }

      return processedTxs;
    },
    traceContext
  );
}

// ============================================================================
// 5. TRACING EXTERNAL SERVICE CALLS
// ============================================================================

export async function callExternalRpcProvider(
  endpoint: string,
  method: string,
  params: any[],
  parentSpan: any
) {
  return await TracerUtil.traceAsync(
    'external.rpc_provider_call',
    async (span) => {
      span.setTag('rpc.endpoint', endpoint);
      span.setTag('rpc.method', method);
      span.setTag('rpc.params.count', params.length);

      // Inject trace context into RPC call
      const traceHeaders = TracerUtil.injectTraceContext(span);

      try {
        const startTime = Date.now();
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...traceHeaders,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
            id: 1,
          }),
        });

        const duration = Date.now() - startTime;
        span.setTag('http.status_code', response.status);
        span.setTag('rpc.duration_ms', duration);

        const data = await response.json();

        if (data.error) {
          span.setTag('error', true);
          span.log({
            event: 'error',
            'rpc.error.code': data.error.code,
            'rpc.error.message': data.error.message,
          });
        }

        return data.result;
      } catch (error) {
        span.setTag('error', true);
        span.log({
          event: 'connection_error',
          message: (error as Error).message,
        });
        throw error;
      }
    },
    parentSpan
  );
}

// ============================================================================
// 6. TRACING JOB QUEUE PROCESSING
// ============================================================================

export async function processJobFromQueue(job: any, traceContext: any) {
  return await TracerUtil.traceAsync(
    'job.process',
    async (jobSpan) => {
      jobSpan.setTag('job.id', job.id);
      jobSpan.setTag('job.type', job.type);
      jobSpan.setTag('job.priority', job.priority);
      jobSpan.setBaggageItem('job.id', job.id);

      TracerUtil.logEvent(jobSpan, 'job.started', {
        retries: job.retries,
        createdAt: job.createdAt,
      });

      try {
        let result;

        if (job.type === 'simulate_contract') {
          result = await TracerUtil.traceAsync(
            'job.simulate_contract',
            async (simSpan) => {
              simSpan.setTag('contract', job.data.contract);
              return await simulateContractJob(job.data);
            },
            jobSpan
          );
        } else if (job.type === 'process_event') {
          result = await TracerUtil.traceAsync(
            'job.process_event',
            async (evtSpan) => {
              evtSpan.setTag('event.type', job.data.eventType);
              return await processEventJob(job.data);
            },
            jobSpan
          );
        }

        TracerUtil.logEvent(jobSpan, 'job.completed', {
          status: 'success',
          result: result ? 'available' : 'null',
        });

        return result;
      } catch (error) {
        jobSpan.setTag('error', true);
        TracerUtil.logEvent(jobSpan, 'job.failed', {
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
        throw error;
      }
    },
    traceContext
  );
}

// ============================================================================
// 7. ACCESSING TRACE INFORMATION IN MIDDLEWARE
// ============================================================================

export function traceLoggingMiddleware() {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Log with trace ID for correlation
    const traceId = req.traceId;
    const originalLog = console.log;

    // Wrap console.log to include trace ID
    (console as any).log = (...args: any[]) => {
      originalLog(`[${traceId}]`, ...args);
    };

    res.on('finish', () => {
      (console as any).log = originalLog;
    });

    next();
  };
}

// ============================================================================
// 8. MONITORING TRACE METRICS
// ============================================================================

export function getTraceMetrics(traceId: string) {
  const tracer = getTracer();

  return {
    traceId,
    jaegerUrl: `http://localhost:16686/search?service=vaultdao-backend&trace=${traceId}`,
    documentation: `
      View this trace in Jaeger UI to see:
      - Full request timeline
      - All child spans and their durations
      - Logs and error messages
      - Service dependencies
      - Tag filtering
    `,
  };
}

// ============================================================================
// HELPER FUNCTIONS (Simulated)
// ============================================================================

async function validateContractParams(params: any[]): Promise<void> {
  // Implementation
}

async function executeContractCall(data: any): Promise<any> {
  // Implementation
  return { status: 'success', output: '0x...' };
}

async function queryDatabase(sql: string, params: any[]): Promise<any[]> {
  // Implementation
  return [];
}

async function processTransaction(tx: any): Promise<any> {
  // Implementation
  return { events: [] };
}

async function simulateContractJob(data: any): Promise<any> {
  // Implementation
  return { result: '0x...' };
}

async function processEventJob(data: any): Promise<any> {
  // Implementation
  return { processed: true };
}
