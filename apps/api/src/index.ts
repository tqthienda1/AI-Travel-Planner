import { buildApp } from "./app.js";
import { parseServerConfig } from "./config.js";

const { port, host } = parseServerConfig(process.env);

const app = buildApp({ logger: true });

app
  .listen({ port, host })
  .then(() => {
    app.log.info(`API server listening on http://${host}:${port}`);
  })
  .catch((error: unknown) => {
    app.log.error(error, "Failed to start API server");
    process.exit(1);
  });
