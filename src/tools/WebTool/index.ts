import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../Tool.js";
import { truncateText } from "../shared/common.js";

const WebInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("fetch_url"),
    url: z.string().url(),
    allowed_domains: z.array(z.string()).optional(),
    blocked_domains: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("fetch_urls"),
    urls: z.array(z.string().url()).min(1),
    allowed_domains: z.array(z.string()).optional(),
    blocked_domains: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("search"),
    query: z.string(),
    max_results: z.number().optional(),
  }),
]);

export class WebTool implements Tool {
  name = "Web";
  aliases = ["WebFetch", "WebSearch", "FetchWebPage"];
  description = "Fetch remote content or perform simple web searches with lightweight domain controls.";
  category = "web" as const;
  capability = "web" as const;
  inputSchema = WebInputSchema;

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const parsed = WebInputSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, output: "", error: `Invalid input: ${parsed.error.message}` };
    }

    switch (parsed.data.action) {
      case "fetch_url": {
        return fetchUrl(parsed.data.url, parsed.data.allowed_domains, parsed.data.blocked_domains);
      }

      case "fetch_urls": {
        const results = [] as Array<{ url: string; success: boolean; output: string; error?: string }>;
        for (const url of parsed.data.urls) {
          const result = await fetchUrl(url, parsed.data.allowed_domains, parsed.data.blocked_domains);
          results.push({
            url,
            success: result.success,
            output: result.output,
            error: result.error,
          });
        }

        return {
          success: results.every((result) => result.success),
          output: results.map((result) => `${result.url}\n${result.output}`).join("\n\n---\n\n"),
          data: { results },
          summary: `Fetched ${results.length} URLs`,
        };
      }

      case "search": {
        const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(parsed.data.query)}`;
        const response = await fetch(searchUrl, {
          headers: {
            "user-agent": "Pebble-Code/1.0",
          },
        });

        const html = await response.text();
        const matches = Array.from(html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g))
          .slice(0, parsed.data.max_results ?? 5)
          .map((match) => ({
            url: decodeHtml(match[1] ?? ""),
            title: stripHtml(decodeHtml(match[2] ?? "")).trim(),
          }));

        const output = matches.length > 0
          ? matches.map((result, index) => `${index + 1}. ${result.title}\n${result.url}`).join("\n\n")
          : "No search results found.";

        return {
          success: true,
          output,
          data: { query: parsed.data.query, results: matches },
          summary: `Found ${matches.length} web results`,
        };
      }
    }
  }
}

async function fetchUrl(
  url: string,
  allowedDomains?: string[],
  blockedDomains?: string[],
): Promise<ToolResult> {
  const parsedUrl = new URL(url);
  if (allowedDomains && allowedDomains.length > 0 && !allowedDomains.includes(parsedUrl.hostname)) {
    return { success: false, output: "", error: `Domain not allowed: ${parsedUrl.hostname}` };
  }

  if (blockedDomains?.includes(parsedUrl.hostname)) {
    return { success: false, output: "", error: `Domain blocked: ${parsedUrl.hostname}` };
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": "Pebble-Code/1.0",
    },
  });
  const rawText = await response.text();
  const body = response.headers.get("content-type")?.includes("text/html")
    ? stripHtml(rawText)
    : rawText;
  const truncated = truncateText(body.trim(), 20_000, "\n\n[Remote content truncated]");

  return {
    success: response.ok,
    output: truncated.text,
    error: response.ok ? undefined : `Request failed with status ${response.status}`,
    truncated: truncated.truncated,
    data: {
      url,
      status: response.status,
      contentType: response.headers.get("content-type"),
    },
    summary: `Fetched ${url}`,
  };
}

function stripHtml(html: string): string {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
