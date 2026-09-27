/**
 * Tests for the SDK error code registry (errors.ts).
 *
 * This module has full exports from sdk/src/index.ts (ERROR_REGISTRY,
 * getErrorEntry, getErrorDescription, getAllErrorEntries) but had zero test
 * coverage.
 */

import { describe, it, expect } from "vitest";
import {
  ERROR_REGISTRY,
  getErrorEntry,
  getErrorDescription,
  getAllErrorEntries,
} from "./errors";
import { VaultErrorCode } from "./types";

describe("errors.ts", () => {
  describe("getErrorEntry", () => {
    it("returns the full registry entry for a known code", () => {
      const entry = getErrorEntry(VaultErrorCode.Unauthorized);
      expect(entry).toBeDefined();
      expect(entry?.code).toBe(VaultErrorCode.Unauthorized);
      expect(entry?.name).toBe("Unauthorized");
      expect(typeof entry?.description).toBe("string");
    });

    it("returns undefined for a code not in the registry", () => {
      const entry = getErrorEntry(9999 as VaultErrorCode);
      expect(entry).toBeUndefined();
    });
  });

  describe("getErrorDescription", () => {
    it("returns the description string for a known code", () => {
      const desc = getErrorDescription(VaultErrorCode.InsufficientBalance);
      expect(desc).toBe(ERROR_REGISTRY[VaultErrorCode.InsufficientBalance].description);
    });

    it("returns undefined for a code not in the registry", () => {
      expect(getErrorDescription(9999 as VaultErrorCode)).toBeUndefined();
    });
  });

  describe("getAllErrorEntries", () => {
    it("returns every registered entry sorted by code", () => {
      const entries = getAllErrorEntries();

      expect(entries.length).toBe(Object.keys(ERROR_REGISTRY).length);
      const codes = entries.map((e) => e.code);
      expect(codes).toEqual([...codes].sort((a, b) => a - b));
    });

    it("every entry round-trips through getErrorEntry", () => {
      for (const entry of getAllErrorEntries()) {
        expect(getErrorEntry(entry.code)).toEqual(entry);
      }
    });
  });
});
