// Unit tests for settings and usage functionality
const store = require('../src/store');

describe('Settings and Usage', () => {
  beforeEach(() => {
    // Reset store before each test
    store.resetUsage();
    store.setSettings({ monthlyLimit: null });
    jest.clearAllMocks();
  });

  describe('Monthly Limit', () => {
    test('should have monthlyLimit in default settings', () => {
      const settings = store.getSettings();
      expect(settings).toHaveProperty('monthlyLimit');
      expect(settings.monthlyLimit).toBeNull();
    });

    test('should set monthly limit', () => {
      const result = store.setMonthlyLimit(100);
      expect(result.monthlyLimit).toBe(100);
      // resetDate is in usage object
      expect(result.usage?.resetDate).toBeTruthy();
    });

    test('should get monthly limit from settings', () => {
      store.setMonthlyLimit(50);
      const settings = store.getSettings();
      expect(settings.monthlyLimit).toBe(50);
    });

    test('should allow null monthly limit (no limit)', () => {
      store.setMonthlyLimit(null);
      const settings = store.getSettings();
      expect(settings.monthlyLimit).toBeNull();
    });
  });

  describe('Usage Tracking', () => {
    test('should track usage by provider', () => {
      store.updateUsage('openai', 'gpt-4o', 1000, 500, 0.05);
      const usage = store.getUsage();
      
      expect(usage.totalTokens).toBe(1500);
      expect(usage.totalCost).toBe(0.05);
      expect(usage.byProvider.openai).toBeDefined();
      expect(usage.byProvider.openai.tokens).toBe(1500);
      expect(usage.byProvider.openai.cost).toBe(0.05);
      expect(usage.byProvider.openai.requests).toBe(1);
    });

    test('should track usage by model', () => {
      store.updateUsage('openai', 'gpt-4o', 1000, 500, 0.05);
      const usage = store.getUsage();
      
      expect(usage.byModel['gpt-4o']).toBeDefined();
      expect(usage.byModel['gpt-4o'].tokens).toBe(1500);
      expect(usage.byModel['gpt-4o'].cost).toBe(0.05);
      expect(usage.byModel['gpt-4o'].requests).toBe(1);
    });

    test('should aggregate usage across multiple requests', () => {
      store.updateUsage('openai', 'gpt-4o', 1000, 500, 0.05);
      store.updateUsage('openai', 'gpt-4o', 2000, 1000, 0.10);
      const usage = store.getUsage();
      
      expect(usage.totalTokens).toBe(4500);
      expect(usage.totalCost).toBeCloseTo(0.15, 2);
      expect(usage.byModel['gpt-4o'].tokens).toBe(4500);
      expect(usage.byModel['gpt-4o'].cost).toBeCloseTo(0.15, 2);
      expect(usage.byModel['gpt-4o'].requests).toBe(2);
    });

    test('should track usage across different providers', () => {
      store.updateUsage('openai', 'gpt-4o', 1000, 500, 0.05);
      store.updateUsage('anthropic', 'claude-3-5-sonnet', 2000, 1000, 0.12);
      const usage = store.getUsage();
      
      expect(usage.totalTokens).toBe(4500);
      expect(usage.totalCost).toBeCloseTo(0.17, 2);
      expect(usage.byProvider.openai.tokens).toBe(1500);
      expect(usage.byProvider.anthropic.tokens).toBe(3000);
    });

    test('should reset usage', () => {
      store.updateUsage('openai', 'gpt-4o', 1000, 500, 0.05);
      store.resetUsage();
      const usage = store.getUsage();
      
      expect(usage.totalTokens).toBe(0);
      expect(usage.totalCost).toBe(0);
      expect(usage.byProvider).toEqual({});
      expect(usage.byModel).toEqual({});
    });
  });

  describe('Settings Persistence', () => {
    test('should save and retrieve settings', () => {
      store.setSettings({ monthlyLimit: 75 });
      const settings = store.getSettings();
      expect(settings.monthlyLimit).toBe(75);
    });

    test('should merge settings with existing', () => {
      store.setSettings({ provider: 'openai' });
      store.setSettings({ monthlyLimit: 75 });
      const settings = store.getSettings();
      expect(settings.provider).toBe('openai');
      expect(settings.monthlyLimit).toBe(75);
    });

    test('should preserve nested settings on merge', () => {
      store.setSettings({ 
        models: { 
          openai: { fast: 'gpt-4o-mini', smart: 'gpt-4o' } 
        } 
      });
      store.setSettings({ monthlyLimit: 75 });
      const settings = store.getSettings();
      expect(settings.models.openai.fast).toBe('gpt-4o-mini');
      expect(settings.models.openai.smart).toBe('gpt-4o');
      expect(settings.monthlyLimit).toBe(75);
    });
  });

  describe('Usage with Monthly Limit', () => {
    test('should calculate usage percentage against limit', () => {
      store.setMonthlyLimit(100);
      store.updateUsage('openai', 'gpt-4o', 1000, 500, 25);
      const usage = store.getUsage();
      
      const percentage = (usage.totalCost / usage.monthlyLimit) * 100;
      expect(percentage).toBe(25);
    });

    test('should handle zero monthly limit', () => {
      store.setMonthlyLimit(0);
      store.updateUsage('openai', 'gpt-4o', 1000, 500, 0.05);
      const usage = store.getUsage();
      
      expect(usage.monthlyLimit).toBe(0);
    });

    test('should handle null monthly limit (unlimited)', () => {
      store.setMonthlyLimit(null);
      store.updateUsage('openai', 'gpt-4o', 1000, 500, 1000);
      const usage = store.getUsage();
      
      expect(usage.monthlyLimit).toBeNull();
      // Should not throw error when calculating percentage
      const percentage = usage.monthlyLimit ? (usage.totalCost / usage.monthlyLimit) * 100 : null;
      expect(percentage).toBeNull();
    });
  });
});
