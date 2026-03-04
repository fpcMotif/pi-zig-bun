import { AnthropicAdapter, GoogleGenAIAdapter, OpenAIAdapter } from "./providers";
import type { AgentAdapter } from "./types";

export function createAgentFromEnv(): AgentAdapter {
  const provider = (process.env.PI_AGENT_PROVIDER ?? "openai").toLowerCase();
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for anthropic provider");
    }
    return new AnthropicAdapter(apiKey, process.env.ANTHROPIC_MODEL);
  }

  if (provider === "google" || provider === "genai" || provider === "gemini") {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is required for google provider");
    }
    return new GoogleGenAIAdapter(apiKey, process.env.GOOGLE_MODEL);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for openai provider");
  }
  return new OpenAIAdapter(apiKey, process.env.OPENAI_MODEL);
}

export type { AgentAdapter, AgentMessage, AgentRequest, AgentResponse, AgentStreamEvent } from "./types";
