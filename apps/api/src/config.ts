export interface ServerConfig {
  port: number;
  host: string;
}

/**
 * Parses and validates API server port and host from environment variables.
 */
export function parseServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const rawPort = env.PORT?.trim();
  let port = 3001;

  if (rawPort !== undefined && rawPort !== "") {
    if (!/^\d+$/.test(rawPort)) {
      throw new Error(`Invalid PORT "${rawPort}": must be an integer between 1 and 65535.`);
    }
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(`Invalid PORT "${rawPort}": must be an integer between 1 and 65535.`);
    }
    port = parsed;
  }

  const rawHost = env.HOST;
  const host = rawHost === undefined ? "0.0.0.0" : rawHost.trim();
  if (host === "") {
    throw new Error("Invalid HOST: must be a non-empty string.");
  }

  return {
    port,
    host,
  };
}
