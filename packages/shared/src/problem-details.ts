import { z } from "zod";

export const PROBLEM_CONTENT_TYPE = "application/problem+json" as const;

export const ProblemDetailsSchema = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    detail: z.string().min(1).optional(),
    instance: z.string().min(1).optional(),
  })
  .passthrough();

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export interface CreateProblemDetailsInput {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  extensions?: Record<string, unknown>;
}

export function createProblemDetails(input: CreateProblemDetailsInput): ProblemDetails {
  const { type, title, status, detail, instance, extensions } = input;
  return {
    type,
    title,
    status,
    ...(detail !== undefined ? { detail } : {}),
    ...(instance !== undefined ? { instance } : {}),
    ...(extensions ?? {}),
  };
}
