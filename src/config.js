"use strict";

const path = require("node:path");

function loadConfig(env = process.env) {
  const botId = env.LARA_TOPGG_BOT_ID;
  if (typeof botId !== "string" || !/^\d{15,20}$/.test(botId)) {
    throw new Error("LARA_TOPGG_BOT_ID must be a 15-20 digit Discord snowflake");
  }

  const secret = env.TOPGG_WEBHOOK_SECRET;
  if (typeof secret !== "string" || secret.length === 0 || /[\r\n]/.test(secret)) {
    throw new Error("TOPGG_WEBHOOK_SECRET must be a non-empty single-line string");
  }

  const portRaw = env.PORT;
  let port = 3000;
  if (portRaw !== undefined && portRaw !== "") {
    if (typeof portRaw !== "string" || !/^\d+$/.test(portRaw)) {
      throw new Error("PORT must be an integer from 0 through 65535");
    }
    port = Number(portRaw);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error("PORT must be an integer from 0 through 65535");
    }
  }

  const dataDir =
    typeof env.DATA_DIR === "string" && env.DATA_DIR.length > 0
      ? path.resolve(env.DATA_DIR)
      : path.join(process.cwd(), "data");

  return { port, botId, secret, dataDir };
}

module.exports = { loadConfig };
