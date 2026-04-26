import type { RequestHandler } from "express";
import type { BackendRuntime } from "../../server.js";

/**
 * Builds the full metrics snapshot from all runtime services.
 * Called on every request so values are always current.
 */
function collectMetrics(runtime: BackendRuntime) {
  const pollingStatus = runtime.eventPollingService.getStatus();
  const recurringStatus = runtime.recurringIndexerService.getStatus();
  const txCacheStats = runtime.transactionsService.cacheStats();
  const proposalStats = runtime.proposalActivityAggregator.getStats();

  const jobs = runtime.jobManager.getAllJobs().map((job) => ({
    name: job.name,
    running: job.isRunning(),
  }));

  return {
    timestamp: new Date().toISOString(),
    uptime: {
      startedAt: runtime.startedAt,
      uptimeSeconds: Math.floor(
        (Date.now() - new Date(runtime.startedAt).getTime()) / 1000,
      ),
    },
    eventPolling: {
      isPolling: pollingStatus.isPolling,
      lastLedgerPolled: pollingStatus.lastLedgerPolled,
      consecutiveErrors: pollingStatus.errors,
    },
    proposals: {
      totalProposals: proposalStats.totalProposals,
      activeProposals: proposalStats.activeProposals,
      executedProposals: proposalStats.executedProposals,
      rejectedProposals: proposalStats.rejectedProposals,
      expiredProposals: proposalStats.expiredProposals,
      cancelledProposals: proposalStats.cancelledProposals,
      consumerBufferSize: runtime.proposalActivityConsumer.getBufferSize(),
    },
    recurringIndexer: {
      isIndexing: recurringStatus.isIndexing,
      lastLedgerProcessed: recurringStatus.lastLedgerProcessed,
      totalPaymentsIndexed: recurringStatus.totalPaymentsIndexed,
      consecutiveErrors: recurringStatus.errors,
    },
    transactionsCache: {
      size: txCacheStats.size,
      hits: txCacheStats.hits,
      misses: txCacheStats.misses,
      hitRatio:
        txCacheStats.hits + txCacheStats.misses === 0
          ? null
          : txCacheStats.hits / (txCacheStats.hits + txCacheStats.misses),
    },
    jobs,
  };
}

/**
 * Serialises metrics to Prometheus text exposition format.
 * Only scalar numeric metrics are included (no label cardinality explosion).
 */
function toPrometheusText(metrics: ReturnType<typeof collectMetrics>): string {
  const lines: string[] = [];

  const gauge = (name: string, help: string, value: number | null) => {
    if (value === null) return;
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${value}`);
  };

  gauge("vaultdao_uptime_seconds", "Backend uptime in seconds", metrics.uptime.uptimeSeconds);

  gauge("vaultdao_event_polling_active", "1 if event polling is running", metrics.eventPolling.isPolling ? 1 : 0);
  gauge("vaultdao_event_polling_last_ledger", "Last ledger polled", metrics.eventPolling.lastLedgerPolled);
  gauge("vaultdao_event_polling_errors_total", "Consecutive poll errors", metrics.eventPolling.consecutiveErrors);

  gauge("vaultdao_proposals_total", "Total proposals tracked", metrics.proposals.totalProposals);
  gauge("vaultdao_proposals_active", "Active proposals", metrics.proposals.activeProposals);
  gauge("vaultdao_proposals_executed_total", "Executed proposals", metrics.proposals.executedProposals);
  gauge("vaultdao_proposals_rejected_total", "Rejected proposals", metrics.proposals.rejectedProposals);
  gauge("vaultdao_proposals_expired_total", "Expired proposals", metrics.proposals.expiredProposals);
  gauge("vaultdao_proposals_cancelled_total", "Cancelled proposals", metrics.proposals.cancelledProposals);
  gauge("vaultdao_consumer_buffer_size", "Proposal consumer buffer size", metrics.proposals.consumerBufferSize);

  gauge("vaultdao_recurring_indexer_active", "1 if recurring indexer is running", metrics.recurringIndexer.isIndexing ? 1 : 0);
  gauge("vaultdao_recurring_indexer_last_ledger", "Last ledger processed by recurring indexer", metrics.recurringIndexer.lastLedgerProcessed);
  gauge("vaultdao_recurring_payments_indexed_total", "Total recurring payments indexed", metrics.recurringIndexer.totalPaymentsIndexed);
  gauge("vaultdao_recurring_indexer_errors_total", "Consecutive recurring indexer errors", metrics.recurringIndexer.consecutiveErrors);

  gauge("vaultdao_tx_cache_size", "Transaction cache entry count", metrics.transactionsCache.size);
  gauge("vaultdao_tx_cache_hits_total", "Transaction cache hits", metrics.transactionsCache.hits);
  gauge("vaultdao_tx_cache_misses_total", "Transaction cache misses", metrics.transactionsCache.misses);
  gauge("vaultdao_tx_cache_hit_ratio", "Transaction cache hit ratio (0–1)", metrics.transactionsCache.hitRatio);

  for (const job of metrics.jobs) {
    const safeName = job.name.replace(/[^a-zA-Z0-9_]/g, "_");
    gauge(
      `vaultdao_job_running{job="${job.name}"}`,
      `1 if job ${safeName} is running`,
      job.running ? 1 : 0,
    );
  }

  return lines.join("\n") + "\n";
}

/**
 * GET /api/v1/metrics
 *
 * Returns backend operational metrics aggregated from all runtime services.
 * Responds with JSON by default; set Accept: text/plain for Prometheus format.
 *
 * This endpoint is intentionally unauthenticated for scraper compatibility.
 */
export function getMetricsController(runtime: BackendRuntime): RequestHandler {
  return (_request, response) => {
    const metrics = collectMetrics(runtime);

    const acceptsPlain = (_request.get("Accept") ?? "").includes("text/plain");

    if (acceptsPlain) {
      response
        .status(200)
        .set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        .send(toPrometheusText(metrics));
      return;
    }

    response
      .status(200)
      .set("Content-Type", "application/json")
      .json({ success: true, data: metrics });
  };
}
