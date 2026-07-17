// Model detection module - probes providers for available models and recommends optimal ones
const { OpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenAI } = require('@google/genai');

// Model metadata database with pricing and context info
const MODEL_METADATA = {
  openai: {
    // GPT-5 series (newest)
    'gpt-5': { context: 128000, inputPrice: 1.25, outputPrice: 5.00, description: 'Next-generation GPT model' },
    'gpt-5-mini': { context: 128000, inputPrice: 0.125, outputPrice: 0.50, description: 'Compact GPT-5' },
    'gpt-5-nano': { context: 128000, inputPrice: 0.025, outputPrice: 0.10, description: 'Smallest GPT-5' },
    // GPT-4.1 series
    'gpt-4.1': { context: 1047576, inputPrice: 1.00, outputPrice: 4.00, description: 'Enhanced GPT-4 with 1M context' },
    'gpt-4.1-mini': { context: 1047576, inputPrice: 0.20, outputPrice: 0.80, description: 'Compact GPT-4.1' },
    'gpt-4.1-nano': { context: 1047576, inputPrice: 0.05, outputPrice: 0.20, description: 'Smallest GPT-4.1' },
    // GPT-4o series
    'gpt-4o': { context: 128000, inputPrice: 2.50, outputPrice: 10.00, description: 'Flagship multimodal model' },
    'gpt-4o-mini': { context: 128000, inputPrice: 0.15, outputPrice: 0.60, description: 'Fast, affordable multimodal' },
    // GPT-4 series (legacy)
    'gpt-4-turbo': { context: 128000, inputPrice: 10.00, outputPrice: 30.00, description: 'High performance GPT-4' },
    'gpt-4': { context: 8192, inputPrice: 30.00, outputPrice: 60.00, description: 'Original GPT-4' },
    'gpt-4-32k': { context: 32768, inputPrice: 60.00, outputPrice: 120.00, description: 'GPT-4 with 32K context' },
    // GPT-3.5 series (legacy)
    'gpt-3.5-turbo': { context: 16385, inputPrice: 0.50, outputPrice: 1.50, description: 'Fast and cost-effective' },
    'gpt-3.5-turbo-16k': { context: 16384, inputPrice: 3.00, outputPrice: 4.00, description: 'GPT-3.5 with 16K context' },
    // O-series reasoning models
    'o1': { context: 200000, inputPrice: 15.00, outputPrice: 60.00, description: 'Advanced reasoning model' },
    'o1-mini': { context: 128000, inputPrice: 1.10, outputPrice: 4.40, description: 'Fast reasoning model' },
    'o3': { context: 200000, inputPrice: 2.00, outputPrice: 8.00, description: 'Next-gen reasoning model' },
    'o3-mini': { context: 128000, inputPrice: 1.10, outputPrice: 4.40, description: 'Compact O3' },
    'o4-mini': { context: 128000, inputPrice: 1.10, outputPrice: 4.40, description: 'Latest compact reasoning' }
  },
  anthropic: {
    // Claude 5 series (newest)
    'claude-fable-5': { context: 1000000, inputPrice: 10.00, outputPrice: 50.00, description: 'Most capable Claude model' },
    'claude-mythos-5': { context: 1000000, inputPrice: 10.00, outputPrice: 50.00, description: 'Limited availability flagship' },
    // Claude 4.8 series
    'claude-opus-4-8': { context: 1000000, inputPrice: 5.00, outputPrice: 25.00, description: 'Highest capability Opus' },
    'claude-opus-4-7': { context: 1000000, inputPrice: 5.00, outputPrice: 25.00, description: 'Previous Opus generation' },
    'claude-opus-4-6': { context: 1000000, inputPrice: 5.00, outputPrice: 25.00, description: 'Older Opus with adaptive thinking' },
    // Claude Sonnet 5 series
    'claude-sonnet-5': { context: 1000000, inputPrice: 3.00, outputPrice: 15.00, description: 'Best speed/intelligence balance' },
    'claude-sonnet-4-6': { context: 1000000, inputPrice: 3.00, outputPrice: 15.00, description: 'Previous Sonnet generation' },
    'claude-sonnet-4-5': { context: 200000, inputPrice: 3.00, outputPrice: 15.00, description: 'Older Sonnet' },
    // Claude Haiku 4.5 series
    'claude-haiku-4-5': { context: 200000, inputPrice: 1.00, outputPrice: 5.00, description: 'Fastest Claude model' },
    'claude-haiku-4-5-20251001': { context: 200000, inputPrice: 1.00, outputPrice: 5.00, description: 'Haiku with extended thinking' },
    // Claude 3.5 series (legacy)
    'claude-3-5-sonnet-20241022': { context: 200000, inputPrice: 3.00, outputPrice: 15.00, description: 'Balanced performance' },
    'claude-3-5-sonnet-latest': { context: 200000, inputPrice: 3.00, outputPrice: 15.00, description: 'Latest 3.5 Sonnet' },
    'claude-3-5-haiku-20241022': { context: 200000, inputPrice: 0.25, outputPrice: 1.25, description: 'Fast and affordable' },
    'claude-3-5-haiku-latest': { context: 200000, inputPrice: 0.25, outputPrice: 1.25, description: 'Latest 3.5 Haiku' },
    // Claude 3 series (legacy)
    'claude-3-opus-20240229': { context: 200000, inputPrice: 15.00, outputPrice: 75.00, description: 'Highest capability 3.x' },
    'claude-3-sonnet-20240229': { context: 200000, inputPrice: 3.00, outputPrice: 15.00, description: 'Balanced 3.x' },
    'claude-3-haiku-20240307': { context: 200000, inputPrice: 0.25, outputPrice: 1.25, description: 'Fast 3.x' }
  },
  gemini: {
    // Gemini 3 series (newest)
    'gemini-3.5-flash': { context: 1000000, inputPrice: 0.50, outputPrice: 3.00, description: 'Most intelligent for speed' },
    'gemini-3.1-pro-preview': { context: 1000000, inputPrice: 2.00, outputPrice: 12.00, description: 'Latest SOTA reasoning' },
    'gemini-3-flash-preview': { context: 1000000, inputPrice: 0.50, outputPrice: 3.00, description: 'Preview Gemini 3 Flash' },
    'gemini-3.1-flash-lite': { context: 1000000, inputPrice: 0.25, outputPrice: 1.50, description: 'Most cost-efficient' },
    'gemini-3-pro-image': { context: 1000000, inputPrice: 2.00, outputPrice: 12.00, description: 'Gemini 3 Pro Image (Nano Banana Pro)' },
    'gemini-3.1-flash-image': { context: 1000000, inputPrice: 0.25, outputPrice: 1.50, description: 'Gemini 3.1 Flash Image (Nano Banana 2)' },
    // Gemini 2.5 series
    'gemini-2.5-pro': { context: 1000000, inputPrice: 1.25, outputPrice: 5.00, description: 'State-of-the-art multipurpose' },
    'gemini-2.5-flash': { context: 1000000, inputPrice: 0.075, outputPrice: 0.30, description: 'Hybrid reasoning model' },
    'gemini-2.5-flash-lite': { context: 1000000, inputPrice: 0.075, outputPrice: 0.30, description: 'Smallest and most cost-effective' },
    'gemini-2.5-flash-image': { context: 1000000, inputPrice: 0.075, outputPrice: 0.30, description: 'Native image generation' },
    // Gemini 2.0 series (deprecated but available)
    'gemini-2.0-flash': { context: 1000000, inputPrice: 0.35, outputPrice: 0.53, description: 'Second generation workhorse' },
    'gemini-2.0-flash-lite': { context: 1000000, inputPrice: 0.35, outputPrice: 0.53, description: 'Compact 2.0 Flash' },
    // Gemini 1.5 series (legacy)
    'gemini-1.5-pro': { context: 1000000, inputPrice: 1.25, outputPrice: 5.00, description: 'High capability 1.5' },
    'gemini-1.5-flash': { context: 1000000, inputPrice: 0.075, outputPrice: 0.30, description: 'Fast and affordable 1.5' },
    'gemini-1.0-pro': { context: 1000000, inputPrice: 0.50, outputPrice: 1.50, description: 'Versatile 1.0' }
  }
};

/**
 * Detect available models for a given provider and API key
 * @param {string} provider - 'openai', 'anthropic', or 'gemini'
 * @param {string} apiKey - The API key to use for detection
 * @returns {Promise<Object>} - Object with available models and metadata
 */
async function detectModels(provider, apiKey) {
  try {
    switch (provider) {
      case 'openai':
        return await detectOpenAIModels(apiKey);
      case 'anthropic':
        return await detectAnthropicModels(apiKey);
      case 'gemini':
        return await detectGeminiModels(apiKey);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error) {
    console.error(`Model detection failed for ${provider}:`, error.message);
    return {
      success: false,
      error: error.message,
      available: [],
      recommended: null
    };
  }
}

/**
 * Detect OpenAI models using the models.list API
 */
async function detectOpenAIModels(apiKey) {
  const client = new OpenAI({ apiKey });
  
  try {
    const models = await client.models.list();
    const modelIds = models.data.map(m => m.id);
    
    // Filter for chat models and sort by quality
    const chatModels = modelIds.filter(id => 
      id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3')
    ).filter(id => 
      !id.includes('audio') && 
      !id.includes('image') &&
      !id.includes('tts') &&
      !id.includes('realtime')
    );
    
    // Remove duplicates and sort
    const uniqueModels = [...new Set(chatModels)];
    
    // Add metadata to each model
    const modelsWithMetadata = uniqueModels.map(id => ({
      id,
      ...getModelMetadata('openai', id)
    }));
    
    // Sort by quality (input price as proxy)
    const sortedModels = modelsWithMetadata.sort((a, b) => (a.inputPrice || 999) - (b.inputPrice || 999));
    
    const recommended = sortedModels.find(m => m.id === 'gpt-4o') || sortedModels[0];
    
    return {
      success: true,
      provider: 'openai',
      available: sortedModels,
      recommended: recommended?.id || 'gpt-4o-mini',
      fast: sortedModels.find(m => m.id.includes('mini'))?.id || sortedModels[0]?.id,
      smart: sortedModels.find(m => m.id.includes('4o') || m.id.includes('4'))?.id || sortedModels[0]?.id
    };
  } catch (error) {
    // Fallback: use static model list
    return await fallbackOpenAIDetection(apiKey);
  }
}

/**
 * Fallback detection for OpenAI using static list
 */
async function fallbackOpenAIDetection(apiKey) {
  const staticModels = [
    // GPT-5 series
    'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
    // GPT-4.1 series
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    // GPT-4o series
    'gpt-4o', 'gpt-4o-mini',
    // GPT-4 series
    'gpt-4-turbo', 'gpt-4', 'gpt-4-32k',
    // GPT-3.5 series
    'gpt-3.5-turbo', 'gpt-3.5-turbo-16k',
    // O-series
    'o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini'
  ];
  
  const modelsWithMetadata = staticModels.map(id => ({
    id,
    ...getModelMetadata('openai', id)
  }));
  
  const sortedModels = modelsWithMetadata.sort((a, b) => (a.inputPrice || 999) - (b.inputPrice || 999));
  
  return {
    success: true,
    provider: 'openai',
    available: sortedModels,
    recommended: 'gpt-5',
    fast: 'gpt-5-mini',
    smart: 'gpt-5'
  };
}

/**
 * Detect Anthropic models using models.list API
 */
async function detectAnthropicModels(apiKey) {
  const client = new Anthropic({ apiKey });
  
  try {
    const models = await client.models.list();
    const modelIds = models.data.map(m => m.id);
    
    // Filter for Claude models
    const claudeModels = modelIds.filter(id => id.startsWith('claude-'));
    
    // Add metadata to each model
    const modelsWithMetadata = claudeModels.map(id => ({
      id: id.replace('claude-', ''), // Normalize ID
      fullId: id,
      ...getModelMetadata('anthropic', id)
    }));
    
    // Sort by quality (input price as proxy)
    const sortedModels = modelsWithMetadata.sort((a, b) => (a.inputPrice || 999) - (b.inputPrice || 999));
    
    const recommended = sortedModels.find(m => m.id.includes('sonnet')) || sortedModels[0];
    
    return {
      success: true,
      provider: 'anthropic',
      available: sortedModels,
      recommended: recommended?.id || 'claude-3-5-sonnet-20241022',
      fast: sortedModels.find(m => m.id.includes('haiku'))?.id || sortedModels[0]?.id,
      smart: sortedModels.find(m => m.id.includes('sonnet') || m.id.includes('opus'))?.id || sortedModels[0]?.id
    };
  } catch (error) {
    // Fallback: use static list
    return await fallbackAnthropicDetection();
  }
}

/**
 * Fallback detection for Anthropic using static list
 */
async function fallbackAnthropicDetection() {
  const staticModels = [
    // Claude 5 series
    'claude-fable-5', 'claude-mythos-5',
    // Claude 4.8 series
    'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
    // Claude Sonnet 5 series
    'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5',
    // Claude Haiku 4.5 series
    'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
    // Claude 3.5 series
    'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-20241022', 'claude-3-5-haiku-latest',
    // Claude 3 series
    'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'
  ];
  
  const modelsWithMetadata = staticModels.map(id => ({
    id,
    ...getModelMetadata('anthropic', id)
  }));
  
  const sortedModels = modelsWithMetadata.sort((a, b) => (a.inputPrice || 999) - (b.inputPrice || 999));
  
  return {
    success: true,
    provider: 'anthropic',
    available: sortedModels,
    recommended: 'claude-fable-5',
    fast: 'claude-haiku-4-5',
    smart: 'claude-fable-5'
  };
}

/**
 * Detect Gemini models using listModels API
 */
async function detectGeminiModels(apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  
  try {
    const models = await ai.listModels();
    const modelIds = models.map(m => m.name.replace('models/', ''));
    
    // Filter for generative models
    const genModels = modelIds.filter(id => 
      id.startsWith('gemini-') && 
      !id.includes('vision') &&
      !id.includes('audio')
    );
    
    // Add metadata to each model
    const modelsWithMetadata = genModels.map(id => ({
      id,
      ...getModelMetadata('gemini', id)
    }));
    
    // Sort by quality (input price as proxy)
    const sortedModels = modelsWithMetadata.sort((a, b) => (a.inputPrice || 999) - (b.inputPrice || 999));
    
    const recommended = sortedModels.find(m => m.id.includes('pro')) || sortedModels[0];
    
    return {
      success: true,
      provider: 'gemini',
      available: sortedModels,
      recommended: recommended?.id || 'gemini-1.5-pro',
      fast: sortedModels.find(m => m.id.includes('flash') || m.id.includes('lite'))?.id || sortedModels[0]?.id,
      smart: sortedModels.find(m => m.id.includes('pro'))?.id || sortedModels[0]?.id
    };
  } catch (error) {
    // Fallback: use static list
    return await fallbackGeminiDetection();
  }
}

/**
 * Fallback detection for Gemini using static list
 */
async function fallbackGeminiDetection() {
  const staticModels = [
    // Gemini 3 series
    'gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview',
    'gemini-3.1-flash-lite', 'gemini-3-pro-image', 'gemini-3.1-flash-image',
    // Gemini 2.5 series
    'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-image',
    // Gemini 2.0 series
    'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    // Gemini 1.5 series
    'gemini-1.5-pro', 'gemini-1.5-flash',
    // Gemini 1.0 series
    'gemini-1.0-pro'
  ];
  
  const modelsWithMetadata = staticModels.map(id => ({
    id,
    ...getModelMetadata('gemini', id)
  }));
  
  const sortedModels = modelsWithMetadata.sort((a, b) => (a.inputPrice || 999) - (b.inputPrice || 999));
  
  return {
    success: true,
    provider: 'gemini',
    available: sortedModels,
    recommended: 'gemini-3.5-flash',
    fast: 'gemini-3.1-flash-lite',
    smart: 'gemini-3.1-pro-preview'
  };
}

/**
 * Get model metadata from the database
 */
function getModelMetadata(provider, modelId) {
  const providerData = MODEL_METADATA[provider] || {};
  
  // Try exact match first
  if (providerData[modelId]) {
    return providerData[modelId];
  }
  
  // Try partial match for versioned models
  for (const [key, value] of Object.entries(providerData)) {
    if (modelId.includes(key) || key.includes(modelId)) {
      return value;
    }
  }
  
  // Return default metadata
  return {
    context: 128000,
    inputPrice: 1.00,
    outputPrice: 2.00,
    description: 'Model'
  };
}

/**
 * Cache detection results to avoid repeated API calls
 */
const detectionCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function detectModelsWithCache(provider, apiKey) {
  const cacheKey = `${provider}:${apiKey}`;
  const cached = detectionCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  
  const result = await detectModels(provider, apiKey);
  detectionCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });
  
  return result;
}

module.exports = {
  detectModels,
  detectModelsWithCache
};
