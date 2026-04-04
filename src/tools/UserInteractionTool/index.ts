import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const UserInteractionInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ask"),
    question: z.string(),
    options: z.array(z.string()).optional(),
    allow_freeform: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("confirm"),
    question: z.string(),
    yes_label: z.string().optional(),
    no_label: z.string().optional(),
  }),
  z.object({
    action: z.literal("request_approval"),
    question: z.string(),
    choices: z.array(z.string()).optional(),
  }),
]);

export class UserInteractionTool implements Tool {
  name = "UserInteraction";
  aliases = ["AskUserQuestion", "Confirm", "PromptUser"];
  description = "Ask the user a question, request a confirmation, or capture a structured approval choice through one interaction surface.";
  category = "user-interaction" as const;
  capability = "user-interaction" as const;
  inputSchema = UserInteractionInputSchema;

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const parsed = UserInteractionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    switch (parsed.data.action) {
      case "ask": {
        const payload = {
          interaction: "question",
          question: parsed.data.question,
          options: parsed.data.options ?? [],
          allowFreeform: parsed.data.allow_freeform ?? true,
        };

        return {
          success: true,
          output: JSON.stringify({ status: "prompt_sent", ...payload }),
          data: payload,
          summary: `Asked user: ${parsed.data.question}`,
        };
      }

      case "confirm": {
        const payload = {
          interaction: "question",
          question: parsed.data.question,
          options: [parsed.data.yes_label ?? "yes", parsed.data.no_label ?? "no"],
          allowFreeform: false,
        };

        return {
          success: true,
          output: JSON.stringify({ status: "confirmation_requested", ...payload }),
          data: payload,
          summary: `Requested confirmation: ${parsed.data.question}`,
        };
      }

      case "request_approval": {
        const payload = {
          interaction: "question",
          question: parsed.data.question,
          options: parsed.data.choices ?? ["allow", "deny", "allow-session", "allow-always"],
          allowFreeform: false,
        };

        return {
          success: true,
          output: JSON.stringify({ status: "approval_requested", ...payload }),
          data: payload,
          summary: `Requested approval: ${parsed.data.question}`,
        };
      }
    }
  }
}
