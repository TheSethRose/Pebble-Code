/**
 * AskUserQuestionTool — prompts the user for input during agent execution.
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";

const AskUserInputSchema = z.object({
  question: z.string().describe("The question to ask the user"),
  options: z.array(z.string()).optional().describe("Optional list of predefined answer options"),
  allow_freeform: z.boolean().optional().describe("Whether to allow freeform text answers (default: true)"),
});

export class AskUserQuestionTool implements Tool {
  name = "AskUserQuestion";
  description = "Ask the user a question and wait for their response. Use when you need clarification, user preferences, or confirmation before proceeding.";

  inputSchema = AskUserInputSchema;

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const parsed = AskUserInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    const { question, options, allow_freeform = true } = parsed.data;

    // In interactive mode, this would display a UI prompt.
    // For now, return a structured request for the UI layer.
    const promptData = {
      question,
      options: options ?? [],
      allow_freeform,
    };

    return {
      success: true,
      output: JSON.stringify({ status: "prompt_sent", ...promptData }),
      data: promptData,
    };
  }

  requiresApproval(): boolean {
    return false; // This tool IS the approval mechanism
  }
}
