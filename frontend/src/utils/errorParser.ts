export interface VaultError {
    code: string;
    message: string;
}

export const parseError = (error: unknown): VaultError => {
    if (!error) {
        return { code: "UNKNOWN", message: "An unknown error occurred." };
    }

    const e = (error as { message?: string; title?: string }) || {};

    // Handle Freighter/Wallet errors
    if (e.title === "Freighter Error") {
        return { code: "WALLET_ERROR", message: "Transaction rejected by wallet." };
    }

    // Handle Simulation Errors
    const simulatedLog = e.message || "";

    if (simulatedLog.includes("Error(Contract, #1)")) {
        return { code: "NOT_INITIALIZED", message: "Contract not initialized." };
    }
    if (simulatedLog.includes("Error(Contract, #2)")) {
        return { code: "ALREADY_INITIALIZED", message: "Contract already initialized." };
    }
    if (simulatedLog.includes("Error(Contract, #100)")) {
        return { code: "UNAUTHORIZED", message: "You are not authorized to perform this action." };
    }
    if (simulatedLog.includes("Error(Contract, #101)")) {
        return { code: "INSUFFICIENT_FUNDS", message: "Insufficient vault balance." };
    }
    if (simulatedLog.includes("Error(Contract, #102)")) {
        return { code: "THRESHOLD_NOT_MET", message: "Proposal approval threshold not met." };
    }

    // Custom Errors Mapping (from errors.rs)
    // These need to be synced with the Error enum integers in Rust
    // Example: ExceedsDailyLimit
    if (simulatedLog.includes("Error(Contract, #110)")) { // Hypothetical ID
        return { code: "DAILY_LIMIT_EXCEEDED", message: "Daily spending limit exceeded." };
    }

    return {
        code: "RPC_ERROR",
        message: e.message || "Failed to submit transaction."
    };
};
