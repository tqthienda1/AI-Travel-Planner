import { PROBLEM_CONTENT_TYPE, createProblemDetails } from "@ai-travel-planner/shared";
import Fastify, { type FastifyInstance } from "fastify";

export interface BuildAppOptions {
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "ai-travel-planner-api",
    };
  });

  app.setNotFoundHandler((request, reply) => {
    const problem = createProblemDetails({
      type: "https://ai-travel-planner.local/problems/not-found",
      title: "Not Found",
      status: 404,
      detail: `Route ${request.method} ${request.url} does not exist.`,
      instance: request.url,
    });
    return reply.code(404).type(PROBLEM_CONTENT_TYPE).send(problem);
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const maybeStatus =
      typeof error === "object" && error !== null && "statusCode" in error
        ? (error as { statusCode?: unknown }).statusCode
        : undefined;
    const statusCode =
      typeof maybeStatus === "number" && maybeStatus >= 400 && maybeStatus <= 599
        ? maybeStatus
        : 500;
    const message = error instanceof Error ? error.message : "Request failed.";

    const problem = createProblemDetails({
      type: "https://ai-travel-planner.local/problems/internal-error",
      title: statusCode >= 500 ? "Internal Server Error" : "Request Error",
      status: statusCode,
      detail:
        statusCode >= 500 ? "An unexpected error occurred while processing the request." : message,
      instance: request.url,
    });

    return reply.code(statusCode).type(PROBLEM_CONTENT_TYPE).send(problem);
  });

  return app;
}
