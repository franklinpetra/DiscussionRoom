import { z } from "zod";

const password = z.string().min(12).max(128);

export const signInSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export const signUpSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  password,
});

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(80);

export const projectInputSchema = z.object({
  workspaceId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
});

export const conversationInputSchema = z.object({
  workspaceId: z.uuid(),
  projectId: z.uuid().optional(),
  title: z.string().trim().min(2).max(160),
});
