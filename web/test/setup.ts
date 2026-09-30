import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach } from "vitest";
import { closeDb } from "../src/lib/db";

// Each test starts with an empty "device".
beforeEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});
