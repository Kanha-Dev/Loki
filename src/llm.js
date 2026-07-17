// LLM factory — OpenAI / Anthropic / Gemini behind one streaming interface.
// stream({ system, turns:[{role,text}], imageDataUrl, maxTokens, onToken }) -> Promise<fullText>

function stripDataUrl(dataUrl) {
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl || '');
  return m ? { mime: m[1], b64: m[2] } : null;
}

const GEMINI_MODEL_ALIASES = {
  'gemini-flash': 'gemini-3.1-flash-lite',
  'gemini-2.0-flash': 'gemini-3.1-flash-lite',
  'gemini-1.5': 'gemini-3.1-flash-lite',
  'gemini-1.5-flash': 'gemini-3.1-flash-lite',
  'gemini-1.5-pro': 'gemini-2.5-pro',
  'gemini-2.5-flash-lite': 'gemini-3.1-flash-lite',
  'gemini-2.5-flash': 'gemini-2.5-pro',
  'gemini-3.5-flash': 'gemini-3.1-flash-lite'
};
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

async function streamOpenAI({ apiKey, model, system, turns, imageDataUrl, imageDataUrls, maxTokens, onToken, onRateLimitInfo }) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey });
  const messages = [{ role: 'system', content: system }];
  const urls = imageDataUrls || (imageDataUrl ? [imageDataUrl] : []);
  turns.forEach((t, i) => {
    const last = i === turns.length - 1;
    if (last && urls.length && t.role === 'user') {
      const content = [{ type: 'text', text: t.text }];
      urls.forEach(url => {
        content.push({ type: 'image_url', image_url: { url } });
      });
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: t.role, content: t.text });
    }
  });
  try {
    const stream = await client.chat.completions.create({ model, messages, stream: true, max_tokens: maxTokens });
    let full = '';
    let rateLimitInfo = null;
    
    for await (const part of stream) {
      // Capture rate limit info from response headers
      if (part._response && part._response.headers && !rateLimitInfo) {
        const headers = part._response.headers;
        rateLimitInfo = {
          provider: 'openai',
          requestsLimit: headers['x-ratelimit-limit-requests'],
          requestsRemaining: headers['x-ratelimit-remaining-requests'],
          requestsReset: headers['x-ratelimit-reset-requests'],
          tokensLimit: headers['x-ratelimit-limit-tokens'],
          tokensRemaining: headers['x-ratelimit-remaining-tokens'],
          tokensReset: headers['x-ratelimit-reset-tokens']
        };
        if (onRateLimitInfo && rateLimitInfo) {
          onRateLimitInfo(rateLimitInfo);
        }
      }
      const d = part.choices && part.choices[0] && part.choices[0].delta && part.choices[0].delta.content;
      if (d) { full += d; onToken(d); }
    }
    return full;
  } catch (err) {
    const status = err?.status || err?.response?.status || err?.code || 'unknown';
    let message = err && err.message ? err.message : String(err);
    if (status === 429 || /429|quota|rate limit/i.test(message)) {
      message = 'OpenAI rate limit / quota error: ' + message + ' Please wait a moment before trying again, or check your billing details.';
    }
    const error = new Error(`OpenAI (${model}) request failed [${status}]: ${message}`);
    error.provider = 'openai';
    error.model = model;
    error.status = status;
    error.code = err?.code;
    throw error;
  }
}

async function streamAnthropic({ apiKey, model, system, turns, imageDataUrl, imageDataUrls, maxTokens, onToken, onRateLimitInfo }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const urls = imageDataUrls || (imageDataUrl ? [imageDataUrl] : []);
  const messages = turns.map((t, i) => {
    const last = i === turns.length - 1;
    if (last && urls.length && t.role === 'user') {
      const content = [];
      urls.forEach(url => {
        const img = stripDataUrl(url);
        if (img) content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } });
      });
      content.push({ type: 'text', text: t.text });
      return { role: 'user', content };
    }
    return { role: t.role, content: t.text };
  });
  const stream = await client.messages.create({ model, max_tokens: maxTokens, system, messages, stream: true });
  let full = '';
  let rateLimitInfo = null;
  
  for await (const ev of stream) {
    // Capture rate limit info from response headers
    if (ev.headers && !rateLimitInfo) {
      const headers = ev.headers;
      rateLimitInfo = {
        provider: 'anthropic',
        requestsLimit: headers['anthropic-ratelimit-requests-limit'],
        requestsRemaining: headers['anthropic-ratelimit-requests-remaining'],
        requestsReset: headers['anthropic-ratelimit-requests-reset'],
        tokensLimit: headers['anthropic-ratelimit-tokens-limit'],
        tokensRemaining: headers['anthropic-ratelimit-tokens-remaining'],
        tokensReset: headers['anthropic-ratelimit-tokens-reset'],
        inputTokensLimit: headers['anthropic-ratelimit-input-tokens-limit'],
        inputTokensRemaining: headers['anthropic-ratelimit-input-tokens-remaining'],
        inputTokensReset: headers['anthropic-ratelimit-input-tokens-reset'],
        outputTokensLimit: headers['anthropic-ratelimit-output-tokens-limit'],
        outputTokensRemaining: headers['anthropic-ratelimit-output-tokens-remaining'],
        outputTokensReset: headers['anthropic-ratelimit-output-tokens-reset']
      };
      if (onRateLimitInfo && rateLimitInfo) {
        onRateLimitInfo(rateLimitInfo);
      }
    }
    if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { full += ev.delta.text; onToken(ev.delta.text); }
  }
  return full;
}

async function streamGemini({ apiKey, model, system, turns, imageDataUrl, imageDataUrls, maxTokens, onToken }) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const urls = imageDataUrls || (imageDataUrl ? [imageDataUrl] : []);
  const contents = turns.map((t, i) => {
    const last = i === turns.length - 1;
    const parts = [{ text: t.text }];
    if (last && urls.length && t.role === 'user') {
      urls.forEach(url => {
        const img = stripDataUrl(url);
        if (img) parts.push({ inlineData: { mimeType: img.mime, data: img.b64 } });
      });
    }
    return { role: t.role === 'assistant' ? 'model' : 'user', parts };
  });
  try {
    const stream = await ai.models.generateContentStream({
      model, contents, config: { systemInstruction: system, maxOutputTokens: maxTokens }
    });
    let full = '';
    for await (const chunk of stream) {
      const t = chunk && chunk.text;
      if (t) { full += t; onToken(t); }
    }
    return full;
  } catch (err) {
    const status = err?.status || err?.statusCode || err?.code || 'unknown';
    let message = err && err.message ? err.message : String(err);
    if (status === 404 || /404|Not Found/i.test(message)) {
      message = 'Gemini model not available: ' + message + ' The configured model may not exist or is deprecated. Try using gemini-3.5-flash (fast) or gemini-2.5-pro (smart) in Settings.';
    } else if (status === 429 || /429|rate limit|quota/i.test(message)) {
      message = 'Gemini quota exceeded: ' + message + ' Your free tier API key has hit its limit. Wait for quota to reset (usually daily), upgrade your plan, or switch to OpenAI/Anthropic.';
    }
    const error = new Error(`Gemini (${model}) request failed [${status}]: ${message}`);
    error.provider = 'gemini';
    error.model = model;
    error.status = status;
    error.code = err?.code;
    throw error;
  }
}

function normalizeGeminiModel(model) {
  if (!model) return DEFAULT_GEMINI_MODEL;
  return GEMINI_MODEL_ALIASES[model] || model;
}

function createLLM(settings) {
  const provider = settings.provider;
  const keys = settings.apiKeys || {};
  const apiKey = keys[provider];
  const tier = settings.smart ? 'smart' : 'fast';
  const model = provider === 'gemini'
    ? normalizeGeminiModel((settings.models[provider] || {})[tier])
    : (settings.models[provider] || {})[tier];
  const maxTokens = settings.smart ? 1400 : 700;

  return {
    provider, model, apiKey,
    ready: !!apiKey && !!model,
    async stream(params) {
      const args = { apiKey, model, maxTokens, ...params };
      if (provider === 'openai') return streamOpenAI(args);
      if (provider === 'anthropic') return streamAnthropic(args);
      if (provider === 'gemini') return streamGemini(args);
      throw new Error('unknown provider: ' + provider);
    }
  };
}

module.exports = { createLLM };
