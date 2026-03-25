import type { BackendEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import { startServer } from "./server.js";

function maskContractId(contractId: string): string {
  if (contractId.length <= 10) return contractId;
  return `${contractId.slice(0, 6)}...${contractId.slice(-6)}`;
}

function logStartupConfig(env: BackendEnv) {
  console.log("[vaultdao-backend] startup config");
  console.log(`- host: ${env.host}`);
  console.log(`- port: ${env.port}`);
  console.log(`- environment: ${env.nodeEnv}`);
  console.log(`- stellar network: ${env.stellarNetwork}`);
  console.log(`- contract id: ${maskContractId(env.contractId)}`);
  console.log(`- soroban rpc: ${env.sorobanRpcUrl}`);
  console.log(`- horizon: ${env.horizonUrl}`);
  console.log(`- websocket: ${env.websocketUrl}`);
}

const env = loadEnv();

logStartupConfig(env);
startServer(env);
