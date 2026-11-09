"use strict";

const http = require("node:http");
const path = require("node:path");

const { createLedger } = require("./ledger");
const { verifySignature } = require("./signature");

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        const error = new Error("request body is too large");
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });

    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      error.statusCode = error.statusCode || 400;
      reject(error);
    });

    req.on("close", () => {
      if (settled || req.complete) return;
      settled = true;
      const error = new Error("request was aborted");
      error.statusCode = 400;
      reject(error);
    });
  });
}

function isValidSnowflake(value) {
  return typeof value === "string" && /^\d{15,20}$/.test(value);
}

async function handleRequest(req, res, context) {
  let url;
  try {
    url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }

  if (url.pathname === "/healthz") {
    if (req.method !== "GET") {
      res.setHeader("allow", "GET");
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (url.pathname !== "/webhooks/topgg") {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const contentType = String(req.headers["content-type"] || "");
  if (!/^application\/json(?:\s*;|$)/i.test(contentType.trim())) {
    sendJson(res, 415, { error: "unsupported_content_type" });
    return;
  }

  let rawBody;
  try {
    rawBody = await readBody(req);
  } catch (error) {
    sendJson(res, error.statusCode || 413, { error: "body_too_large" });
    return;
  }

  const signatureValid = verifySignature({
    header: req.headers["x-topgg-signature"],
    secret: context.secret,
    rawBody,
    now: context.now(),
  });

  if (!signatureValid) {
    sendJson(res, 401, { error: "invalid_signature" });
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  if (
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    typeof event.type !== "string" ||
    !event.data ||
    typeof event.data !== "object" ||
    Array.isArray(event.data)
  ) {
    sendJson(res, 400, { error: "invalid_event" });
    return;
  }

  if (event.type === "webhook.test") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (event.type === "vote.create") {
    const project =
      event.data.project &&
      typeof event.data.project === "object" &&
      !Array.isArray(event.data.project)
        ? event.data.project
        : null;

    if (!project) {
      sendJson(res, 400, { error: "invalid_event" });
      return;
    }

    if (
      project.type !== "bot" ||
      project.platform !== "discord" ||
      project.platform_id !== context.botId
    ) {
      sendJson(res, 200, { status: "ignored" });
      return;
    }

    const eventId = event.data.id;
    const user =
      event.data.user && typeof event.data.user === "object" && !Array.isArray(event.data.user)
        ? event.data.user
        : null;
    const userId = user ? user.platform_id : undefined;
    const weight = event.data.weight;
    const createdAt = event.data.created_at;

    if (
      !isValidSnowflake(eventId) ||
      !isValidSnowflake(userId) ||
      !Number.isInteger(weight) ||
      weight <= 0 ||
      typeof createdAt !== "string" ||
      createdAt.trim() === ""
    ) {
      sendJson(res, 400, { error: "invalid_event" });
      return;
    }

    const receipt = {
      event_id: eventId,
      bot_id: context.botId,
      user_id: userId,
      weight,
      created_at: createdAt,
      received_at: new Date(context.now()).toISOString(),
    };

    try {
      const result = await context.ledger.record(receipt);
      if (result.duplicate) {
        sendJson(res, 200, { status: "duplicate" });
      } else {
        sendJson(res, 200, { status: "accepted" });
      }
    } catch {
      sendJson(res, 500, { error: "storage_error" });
    }
    return;
  }

  sendJson(res, 200, { status: "ignored" });
}

function createServer(options = {}) {
  const botId = options.botId;
  const secret = options.secret;
  if (typeof botId !== "string" || !/^\d{15,20}$/.test(botId)) {
    throw new Error("createServer requires a valid botId");
  }
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("createServer requires a non-empty secret");
  }

  const dataDir =
    typeof options.dataDir === "string" && options.dataDir.length > 0
      ? options.dataDir
      : path.join(process.cwd(), "data");
  const now = typeof options.now === "function" ? options.now : Date.now;

  const ledger = createLedger(path.join(dataDir, "received-votes.jsonl"));
  const context = { botId, secret, dataDir, now, ledger };

  const server = http.createServer((req, res) => {
    handleRequest(req, res, context).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal_error" });
      }
    });
  });

  return server;
}

module.exports = {
  MAX_BODY_BYTES,
  createServer,
  createApp: createServer,
  handleRequest,
};
