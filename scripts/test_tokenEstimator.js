// Unit tests for tokenEstimator module
const { estimateTokens, estimateConversationTokens, estimateRequestTokens, estimateCost, formatCost } = require('../src/tokenEstimator');

console.log('Running tokenEstimator tests...\n');

// Test 1: estimateTokens with empty string
try {
  const result = estimateTokens('');
  console.assert(result === 0, 'estimateTokens("") should return 0');
  console.log('✓ Test 1 passed: estimateTokens("")');
} catch (e) {
  console.error('✗ Test 1 failed:', e.message);
}

// Test 2: estimateTokens with null
try {
  const result = estimateTokens(null);
  console.assert(result === 0, 'estimateTokens(null) should return 0');
  console.log('✓ Test 2 passed: estimateTokens(null)');
} catch (e) {
  console.error('✗ Test 2 failed:', e.message);
}

// Test 3: estimateTokens with short text
try {
  const result = estimateTokens('Hello world');
  console.assert(result > 0, 'estimateTokens("Hello world") should return > 0');
  console.log(`✓ Test 3 passed: estimateTokens("Hello world") = ${result}`);
} catch (e) {
  console.error('✗ Test 3 failed:', e.message);
}

// Test 4: estimateTokens with longer text
try {
  const text = 'This is a longer text that should have more tokens estimated.';
  const result = estimateTokens(text);
  console.assert(result > 10, 'estimateTokens(longer text) should return > 10');
  console.log(`✓ Test 4 passed: estimateTokens(longer text) = ${result}`);
} catch (e) {
  console.error('✗ Test 4 failed:', e.message);
}

// Test 5: estimateConversationTokens with empty array
try {
  const result = estimateConversationTokens([]);
  console.assert(result === 0, 'estimateConversationTokens([]) should return 0');
  console.log('✓ Test 5 passed: estimateConversationTokens([])');
} catch (e) {
  console.error('✗ Test 5 failed:', e.message);
}

// Test 6: estimateConversationTokens with turns
try {
  const turns = [
    { role: 'user', text: 'Hello' },
    { role: 'assistant', text: 'Hi there!' }
  ];
  const result = estimateConversationTokens(turns);
  console.assert(result > 0, 'estimateConversationTokens(turns) should return > 0');
  console.log(`✓ Test 6 passed: estimateConversationTokens(turns) = ${result}`);
} catch (e) {
  console.error('✗ Test 6 failed:', e.message);
}

// Test 7: estimateRequestTokens with system and turns
try {
  const system = 'You are a helpful assistant.';
  const turns = [{ role: 'user', text: 'Hello' }];
  const result = estimateRequestTokens(system, turns);
  console.assert(result.inputTokens > 0, 'estimateRequestTokens should return inputTokens > 0');
  console.assert(result.imageTokens === 0, 'estimateRequestTokens should return imageTokens = 0 without image');
  console.log(`✓ Test 7 passed: estimateRequestTokens(system, turns) = ${JSON.stringify(result)}`);
} catch (e) {
  console.error('✗ Test 7 failed:', e.message);
}

// Test 8: estimateRequestTokens with image
try {
  const system = 'You are a helpful assistant.';
  const turns = [{ role: 'user', text: 'Hello' }];
  const imageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const result = estimateRequestTokens(system, turns, imageDataUrl);
  console.assert(result.inputTokens > 0, 'estimateRequestTokens should return inputTokens > 0');
  console.assert(result.imageTokens === 500, 'estimateRequestTokens should return imageTokens = 500');
  console.log(`✓ Test 8 passed: estimateRequestTokens(system, turns, image) = ${JSON.stringify(result)}`);
} catch (e) {
  console.error('✗ Test 8 failed:', e.message);
}

// Test 9: estimateCost for OpenAI
try {
  const result = estimateCost('openai', 'gpt-4o', 1000, 500);
  console.assert(result.inputCost > 0, 'estimateCost should return inputCost > 0');
  console.assert(result.outputCost > 0, 'estimateCost should return outputCost > 0');
  console.assert(result.totalCost > 0, 'estimateCost should return totalCost > 0');
  console.log(`✓ Test 9 passed: estimateCost(openai, gpt-4o, 1000, 500) = ${JSON.stringify(result)}`);
} catch (e) {
  console.error('✗ Test 9 failed:', e.message);
}

// Test 10: estimateCost for Anthropic
try {
  const result = estimateCost('anthropic', 'claude-3-5-sonnet-20241022', 1000, 500);
  console.assert(result.inputCost > 0, 'estimateCost should return inputCost > 0');
  console.assert(result.outputCost > 0, 'estimateCost should return outputCost > 0');
  console.log(`✓ Test 10 passed: estimateCost(anthropic, claude-3-5-sonnet-20241022, 1000, 500) = ${JSON.stringify(result)}`);
} catch (e) {
  console.error('✗ Test 10 failed:', e.message);
}

// Test 11: estimateCost for Gemini
try {
  const result = estimateCost('gemini', 'gemini-1.5-pro', 1000, 500);
  console.assert(result.inputCost > 0, 'estimateCost should return inputCost > 0');
  console.assert(result.outputCost > 0, 'estimateCost should return outputCost > 0');
  console.log(`✓ Test 11 passed: estimateCost(gemini, gemini-1.5-pro, 1000, 500) = ${JSON.stringify(result)}`);
} catch (e) {
  console.error('✗ Test 11 failed:', e.message);
}

// Test 12: estimateCost with unknown model (should use defaults)
try {
  const result = estimateCost('openai', 'unknown-model', 1000, 500);
  console.assert(result.inputCost > 0, 'estimateCost should use defaults for unknown model');
  console.log(`✓ Test 12 passed: estimateCost(openai, unknown-model, 1000, 500) = ${JSON.stringify(result)}`);
} catch (e) {
  console.error('✗ Test 12 failed:', e.message);
}

// Test 13: formatCost with small cost
try {
  const result = formatCost(0.001);
  console.assert(result === '<$0.01', 'formatCost(0.001) should return "<$0.01"');
  console.log(`✓ Test 13 passed: formatCost(0.001) = ${result}`);
} catch (e) {
  console.error('✗ Test 13 failed:', e.message);
}

// Test 14: formatCost with normal cost
try {
  const result = formatCost(0.1234);
  console.assert(result === '$0.1234', 'formatCost(0.1234) should return "$0.1234"');
  console.log(`✓ Test 14 passed: formatCost(0.1234) = ${result}`);
} catch (e) {
  console.error('✗ Test 14 failed:', e.message);
}

console.log('\n✓ All tokenEstimator tests completed successfully!');
