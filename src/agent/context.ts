import type { AgentMessage } from "./types";

export interface ConversationContextOptions {
  tokenBudget: number;
  summarize?: (messages: AgentMessage[]) => Promise<string | undefined>;
}

export class ConversationContextManager {
  private readonly tokenBudget: number;
  private readonly summarizeHook?: (messages: AgentMessage[]) => Promise<string | undefined>;

  constructor(options: ConversationContextOptions) {
    this.tokenBudget = Math.max(128, options.tokenBudget);
    this.summarizeHook = options.summarize;
  }

  public async prepare(messages: AgentMessage[]): Promise<AgentMessage[]> {
    if (this.estimate(messages) <= this.tokenBudget) {
      return messages;
    }

    const systemMessages = messages.filter((message) => message.role === "system");
    const conversation = messages.filter((message) => message.role !== "system");

    const trimmed = [...conversation];
    while (trimmed.length > 2 && this.estimate([...systemMessages, ...trimmed]) > this.tokenBudget) {
      trimmed.shift();
    }

    const output = [...systemMessages, ...trimmed];
    if (this.estimate(output) <= this.tokenBudget || !this.summarizeHook) {
      return output;
    }

    const summary = await this.summarizeHook(conversation);
    if (!summary) {
      return output;
    }

    const withSummary: AgentMessage[] = [
      ...systemMessages,
      { role: "system", content: `Summary of earlier context: ${summary}` },
      ...trimmed.slice(-2),
    ];

    return withSummary;
  }

  private estimate(messages: AgentMessage[]): number {
    return messages.reduce((acc, message) => acc + Math.ceil(message.content.length / 4) + 8, 0);
  }
}
