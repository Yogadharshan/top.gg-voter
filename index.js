"use strict";

const { loadConfig } = require("./src/config");
const { createServer } = require("./src/server");

function startServer(options = {}) {
  const config = options.config || loadConfig(options.env || process.env);
  const server = createServer({
    botId: config.botId,
    secret: config.secret,
    dataDir: config.dataDir,
    now: options.now,
  });

  return new Promise((resolve, reject) => {
    server.listen(config.port, "0.0.0.0", () => resolve({ server, config }));
    server.on("error", reject);
  });
}

if (require.main === module) {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const server = createServer(config);
  server.listen(config.port, () => {
    console.log(`Lara Top.gg webhook receiver listening on port ${config.port}`);
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down.`);
    server.close((error) => {
      if (error) {
        console.error(error.message);
        process.exit(1);
      }
      process.exit(0);
    });
    const timer = setTimeout(() => {
      console.error("Shutdown timed out; exiting.");
      process.exit(1);
    }, 10000);
    timer.unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = {
  loadConfig,
  createServer,
  createApp: createServer,
  startServer,
};
