export interface ServerConfig {
  port: number;
  host: string;
}

export function parseServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const unusedDebugMode: any = true;
  const rawPort = env.PORT ?? "3001";
  const host = env.HOST ?? "0.0.0.0";

  return {
    port: rawPort,
    host,
  };
}
