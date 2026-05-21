import * as assert from "assert";
import { LynvoTaskRelationType, LynvoSyncStatus } from "../types";

const relationTypes: LynvoTaskRelationType[] = [
  "blocks",
  "blocked-by",
  "related",
  "duplicates",
];
const syncStatuses: LynvoSyncStatus[] = [
  "idle",
  "pending",
  "syncing",
  "synced",
  "offline",
  "failed",
  "conflict",
];

assert.ok(relationTypes.includes("related"));
assert.ok(syncStatuses.includes("conflict"));
