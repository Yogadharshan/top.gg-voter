const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createServer } = require("../index.js");

const BOT_ID = "123456789012345678";
const SECRET = "test-webhook-secret-not-real";
const MAX_BODY_BYTES = 64 * 1024;

function sign(secret, timestampSeconds, rawBody) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(String(timestampSeconds));
  hmac.update(".");
  hmac.update(rawBody);
  return `t=${timestampSeconds},v1=${hmac.digest("hex")}`;
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "topgg-webhook-"));
}

function startServer(t, options = {}) {
  const dataDir = options.dataDir || makeTempDir();
  const server = createServer({
    botId: BOT_ID,
    secret: SECRET,
    dataDir,
    ...options,
  });
  t.after(() => {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, dataDir });
    });
  });
}

function readReceipts(dataDir) {
  const file = path.join(dataDir, "received-votes.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function postWebhook(baseUrl, bodyBuffer, headers = {}) {
  const response = await fetch(`${baseUrl}/webhooks/topgg`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: bodyBuffer,
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

test("health endpoint returns ok", async (t) => {
  const { baseUrl } = await startServer(t);
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("valid Lara vote is recorded", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "111111111111111111",
      weight: 1,
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 200);
  const receipts = readReceipts(dataDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].event_id, "111111111111111111");
  assert.equal(receipts[0].bot_id, BOT_ID);
  assert.equal(receipts[0].user_id, "987654321098765432");
  assert.equal(receipts[0].created_at, payload.data.created_at);
  assert.match(receipts[0].received_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("invalid signature is rejected", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "111111111111111112",
      weight: 1,
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign("wrong-secret", timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 401);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("stale timestamp is rejected", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "111111111111111113",
      weight: 1,
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000) - 301;
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 401);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("other bot vote is acknowledged and ignored", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "111111111111111114",
      weight: 1,
      project: { type: "bot", platform: "discord", platform_id: "999999999999999999" },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 200);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("webhook.test is acknowledged without recording", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "webhook.test",
    data: {
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 200);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("unknown event type is acknowledged as ignored", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = { type: "project.update", data: { id: "x" } };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 200);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("duplicate delivery is idempotent", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "111111111111111115",
      weight: 1,
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const first = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });
  const second = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(readReceipts(dataDir).length, 1);
});

test("concurrent duplicate deliveries are serialized", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "111111111111111116",
      weight: 1,
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const [first, second] = await Promise.all([
    postWebhook(baseUrl, rawBody, { "x-topgg-signature": signature }),
    postWebhook(baseUrl, rawBody, { "x-topgg-signature": signature }),
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(readReceipts(dataDir).length, 1);
});

test("oversized body is rejected", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const rawBody = Buffer.alloc(MAX_BODY_BYTES + 1, 0x61);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 413);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("malformed JSON is rejected", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const rawBody = Buffer.from("{not-json");
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 400);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("invalid vote identifiers are rejected", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "",
      weight: 1,
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "not-a-snowflake" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 400);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("unsupported content type is rejected", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "webhook.test",
    data: {
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const response = await fetch(`${baseUrl}/webhooks/topgg`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      "x-topgg-signature": signature,
    },
    body: rawBody,
  });

  assert.equal(response.status, 415);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("invalid event id is rejected", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "not-a-snowflake",
      weight: 1,
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 400);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("invalid weight is rejected", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "111111111111111117",
      weight: 0,
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 400);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("wrong project type is acknowledged and ignored", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "111111111111111118",
      weight: 1,
      project: { type: "server", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 200);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("wrong project platform is acknowledged and ignored", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "111111111111111119",
      weight: 1,
      project: { type: "bot", platform: "web", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 200);
  assert.equal(readReceipts(dataDir).length, 0);
});

test("vote weight is recorded", async (t) => {
  const { baseUrl, dataDir } = await startServer(t);
  const payload = {
    type: "vote.create",
    data: {
      id: "111111111111111120",
      weight: 2,
      project: { type: "bot", platform: "discord", platform_id: BOT_ID },
      user: { platform_id: "987654321098765432" },
      created_at: "2026-10-21T12:00:00.000Z",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(SECRET, timestamp, rawBody);

  const result = await postWebhook(baseUrl, rawBody, {
    "x-topgg-signature": signature,
  });

  assert.equal(result.status, 200);
  const receipts = readReceipts(dataDir);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].weight, 2);
});
