export class AgentProvider {
  async decide() {
    throw new AgentProviderError("AgentProvider.decide() is not implemented.", {
      code: "AGENT_PROVIDER_NOT_IMPLEMENTED",
      retryable: false,
    });
  }

  isConfigured() {
    return true;
  }
}

export class AgentProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AgentProviderError";
    this.code = options.code || "AGENT_PROVIDER_ERROR";
    this.retryable = options.retryable === true;
    this.waitingInformation = options.waitingInformation === true;
    this.details = options.details || null;
  }
}
