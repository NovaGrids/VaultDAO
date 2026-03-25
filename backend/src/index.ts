import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { startServer } from "./server.js";
import { createLogger } from "./shared/logging/logger.js";

function maskContractId(contractId: string): string {
  if (contractId.length <= 10) return contractId;
  return `${contractId.slice(0, 6)}...${contractId.slice(-6)}`;
}

function logStartupConfig(env: BackendEnv) {
  const logger = createLogger("vaultdao-backend");
  logger.info("startup config", {
    host: env.host,
    port: env.port,
    environment: env.nodeEnv,
    stellarNetwork: env.stellarNetwork,
    contractId: maskContractId(env.contractId),
    sorobanRpcUrl: env.sorobanRpcUrl,
    horizonUrl: env.horizonUrl,
    websocketUrl: env.websocketUrl,
  });
}

const env = loadEnv();

logStartupConfig(env);
startServer(env);
