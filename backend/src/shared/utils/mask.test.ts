import assert from "node:assert/strict";
import test from "node:test";

import { maskContractId, publicContractIdForApi } from "./mask.js";

const LONG_ID =
  "CDO4B7X6FUM2YUH2BNVQKSHSM5M7XED3SFEHVYJ4V47PVML2P5FCHQ4";

test("maskContractId shortens long IDs", () => {
  assert.equal(
    maskContractId(LONG_ID),
    `${LONG_ID.slice(0, 6)}...${LONG_ID.slice(-6)}`,
  );
});

test("maskContractId leaves short IDs unchanged", () => {
  assert.equal(maskContractId("CDTEST"), "CDTEST");
});

test("publicContractIdForApi returns full ID outside production", () => {
  assert.equal(publicContractIdForApi(LONG_ID, "development"), LONG_ID);
  assert.equal(publicContractIdForApi(LONG_ID, "test"), LONG_ID);
});

test("publicContractIdForApi masks in production", () => {
  assert.equal(publicContractIdForApi(LONG_ID, "production"), maskContractId(LONG_ID));
});
