"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("../src/config");

const VALID_SECRET = "test-webhook-secret-not-real";

test("loadConfig rejects missing or invalid Lara bot IDs", () => {
  const invalidValues = [
    undefined,
    "",
    "REPLACE_WITH_YOUR_LARA_BOT_ID",
    "123",
    "not-a-snowflake",
    "12345678901234567890123",
    "1234567890123456a",
  ];

  for (const botId of invalidValues) {
    assert.throws(
      () => loadConfig({ LARA_TOPGG_BOT_ID: botId, TOPGG_WEBHOOK_SECRET: VALID_SECRET }),
      /LARA_TOPGG_BOT_ID/
    );
  }
});

test("loadConfig rejects missing or invalid webhook secrets", () => {
  const invalidValues = [undefined, "", "line1\nline2"];
  for (const secret of invalidValues) {
    assert.throws(
      () => loadConfig({ LARA_TOPGG_BOT_ID: "123456789012345678", TOPGG_WEBHOOK_SECRET: secret }),
      /TOPGG_WEBHOOK_SECRET/
    );
  }
});

test("loadConfig rejects invalid ports", () => {
  const invalidValues = ["abc", "-1", "65536", "1.5"];
  for (const port of invalidValues) {
    assert.throws(
      () => loadConfig({
        LARA_TOPGG_BOT_ID: "123456789012345678",
        TOPGG_WEBHOOK_SECRET: VALID_SECRET,
        PORT: port,
      }),
      /PORT/
    );
  }
});

test("loadConfig accepts a valid configuration", () => {
  const config = loadConfig({
    LARA_TOPGG_BOT_ID: "123456789012345678",
    TOPGG_WEBHOOK_SECRET: VALID_SECRET,
    PORT: "3001",
    DATA_DIR: "/tmp/topgg-webhook-test-data",
  });

  assert.equal(config.botId, "123456789012345678");
  assert.equal(config.secret, VALID_SECRET);
  assert.equal(config.port, 3001);
  assert.equal(config.dataDir, "/tmp/topgg-webhook-test-data");
});

test(".env.example uses an unmistakably invalid Lara bot ID placeholder", () => {
  const envExample = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  const match = envExample.match(/^LARA_TOPGG_BOT_ID=(.*)$/m);
  assert.ok(match, "LARA_TOPGG_BOT_ID must be present in .env.example");
  assert.throws(
    () => loadConfig({ LARA_TOPGG_BOT_ID: match[1].trim(), TOPGG_WEBHOOK_SECRET: VALID_SECRET }),
    /LARA_TOPGG_BOT_ID/
  );
});