"use strict";

const crypto = require("node:crypto");

function parseSignature(header) {
  if (typeof header !== "string" || header.length === 0) return null;

  const fields = {};
  for (const part of header.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) return null;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key !== "t" && key !== "v1") return null;
    if (fields[key] !== undefined) return null;
    fields[key] = value;
  }

  if (!/^\d+$/.test(fields.t || "")) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(fields.v1 || "")) return null;

  return {
    timestamp: Number(fields.t),
    signature: fields.v1.toLowerCase(),
  };
}

function verifySignature({ header, secret, rawBody, now = Date.now() }) {
  const parsed = parseSignature(header);
  if (!parsed) return false;

  const nowSeconds = Math.floor(now / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(String(parsed.timestamp))
    .update(".")
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(parsed.signature, "hex")
    );
  } catch {
    return false;
  }
}

module.exports = { parseSignature, verifySignature };
