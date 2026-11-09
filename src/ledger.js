"use strict";

const fs = require("node:fs");
const path = require("node:path");

function createLedger(filePath) {
  let queue = Promise.resolve();

  function runExclusive(task) {
    const result = queue.then(task, task);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function readReceipts() {
    try {
      const text = await fs.promises.readFile(filePath, "utf8");
      return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function record(receipt) {
    return runExclusive(async () => {
      const receipts = await readReceipts();
      if (receipts.some((item) => item && item.event_id === receipt.event_id)) {
        return { duplicate: true };
      }

      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.appendFile(
        filePath,
        `${JSON.stringify(receipt)}\n`,
        { mode: 0o600 }
      );
      return { duplicate: false };
    });
  }

  return { filePath, record };
}

module.exports = { createLedger };
