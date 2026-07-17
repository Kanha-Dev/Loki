// Token estimation module - estimates token count for text using heuristics
// For better accuracy with OpenAI, consider integrating tiktoken in the future

/**
 * Estimate token count for a given text
 * Uses a simple heuristic: characters / 4 (rough approximation for most LLM tokenizers)
 * @param {string} text - The text to estimate tokens for
 * @returns {number} - Estimated token count
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  
  // Basic heuristic: average token is ~4 characters for most tokenizers
  // This is a rough approximation but works well enough for cost estimation
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a conversation with multiple turns
 * @param {Array} turns - Array of {role, text} objects
 * @returns {number} - Total estimated tokens
 */
function estimateConversationTokens(turns) {
  if (!turns || !Array.isArray(turns)) return 0;
  
  let total = 0;
  for (const turn of turns) {
    if (turn.text) {
      total += estimateTokens(turn.text);
    }
  }
  
  // Add overhead for role markers and formatting (rough estimate)
  total += turns.length * 4;
  
  return total;
}

/**
 * Estimate tokens for a complete request including system prompt
 * @param {string} system - System prompt
 * @param {Array} turns - Conversation turns
 * @param {string} imageDataUrl - Optional image data URL (images cost differently)
 * @returns {Object} - { inputTokens, imageTokens } estimates
 */
function estimateRequestTokens(system, turns, imageDataUrl) {
  let inputTokens = 0;
  
  // System prompt tokens
  if (system) {
    inputTokens += estimateTokens(system);
  }
  
  // Conversation tokens
  inputTokens += estimateConversationTokens(turns);
  
  // Image tokens (rough estimate - images are charged differently by providers)
  let imageTokens = 0;
  if (imageDataUrl) {
    // Rough estimate: a typical image costs ~85-1000 tokens depending on resolution
    // We'll use a conservative estimate of 500 tokens for cost calculation
    imageTokens = 500;
  }
  
  return {
    inputTokens,
    imageTokens,
    totalTokens: inputTokens + imageTokens
  };
}

/**
 * Estimate cost for a request based on token counts and provider pricing
 * @param {string} provider - 'openai', 'anthropic', or 'gemini'
 * @param {string} model - Model name
 * @param {number} inputTokens - Input token count
 * @param {number} outputTokens - Output token count
 * @param {number} imageTokens - Image token count (if any)
 * @returns {Object} - { inputCost, outputCost, totalCost } in USD
 */
function estimateCost(provider, model, inputTokens, outputTokens, imageTokens = 0) {
  // Pricing per 1M tokens (as of 2024, approximate)
  const pricing = {
    openai: {
      'gpt-4o': { input: 2.50, output: 10.00 },
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
      'gpt-4-turbo': { input: 10.00, output: 30.00 },
      'gpt-4': { input: 30.00, output: 60.00 },
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 }
    },
    anthropic: {
      'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
      'claude-3-5-haiku-20241022': { input: 0.25, output: 1.25 },
      'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
      'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
      'claude-3-haiku-20240307': { input: 0.25, output: 1.25 }
    },
    gemini: {
      'gemini-1.5-pro': { input: 1.25, output: 5.00 },
      'gemini-1.5-flash': { input: 0.075, output: 0.30 },
      'gemini-1.0-pro': { input: 0.50, output: 1.50 }
    }
  };
  
  // Get pricing for the specific model, fallback to provider defaults
  let modelPricing = pricing[provider]?.[model];
  if (!modelPricing) {
    // Use conservative defaults if model not found
    const defaults = {
      openai: { input: 5.00, output: 15.00 },
      anthropic: { input: 5.00, output: 15.00 },
      gemini: { input: 1.00, output: 4.00 }
    };
    modelPricing = defaults[provider] || { input: 5.00, output: 15.00 };
  }
  
  // Calculate costs (convert from per-1M to per-token)
  const inputCost = (inputTokens / 1000000) * modelPricing.input;
  const outputCost = (outputTokens / 1000000) * modelPricing.output;
  
  // Images are typically charged differently, using a rough estimate
  const imageCost = (imageTokens / 1000000) * modelPricing.input * 2; // Images cost ~2x input rate
  
  return {
    inputCost,
    outputCost,
    imageCost,
    totalCost: inputCost + outputCost + imageCost
  };
}

/**
 * Format cost as a readable string
 * @param {number} cost - Cost in USD
 * @returns {string} - Formatted cost string
 */
function formatCost(cost) {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(4)}`;
}

module.exports = {
  estimateTokens,
  estimateConversationTokens,
  estimateRequestTokens,
  estimateCost,
  formatCost
};
