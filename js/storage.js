/**
 * storage.js — localStorage persistence for PHEV Cost Calculator
 * 
 * Saves and loads all user settings under a single key.
 * Auto-save is debounced to avoid excessive writes.
 */

const Storage = (() => {
  const STORAGE_KEY = 'phev-calc-settings';
  const CACHE_KEY = 'phev-calc-cache';

  /**
   * Default settings — empty vehicle config, sensible Riga defaults for pricing
   */
  const DEFAULTS = {
    // Vehicle
    batteryCapacity: '',
    electricRangeSummer: '',
    electricRangeWinter: '',
    season: 'summer',
    manualRange: '',
    useManualRange: false,
    fuelConsumption: '',

    // Fuel
    fuelPrice: 1.53,

    // Electricity — Home
    electricitySource: 'manual', // 'nordpool' | 'manual'
    homeElectricityPrice: 0.22,
    selectedNordPoolHour: 'average', // 'average' | 'range' | hour index (0-23)
    rangeStart: 22, // hour index for range start (0-23)
    rangeEnd: 6,    // hour index for range end, inclusive; supports overnight wrap
    dynamicFeeEnabled: true,
    dynamicFee: 0.039,
    vatEnabled: true,
    vatRate: 21,

    // Electricity — Public
    publicChargingPrice: 0.35,
    publicSessionFee: 0,

    // SOC Calculator
    socStart: 10,
    socTarget: 80,
    socChargeType: 'home', // 'home' | 'public'
  };

  /**
   * Load settings from localStorage, merging with defaults
   */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      const saved = JSON.parse(raw);
      // Merge: saved values override defaults, but new keys from DEFAULTS are included
      return { ...DEFAULTS, ...saved };
    } catch (e) {
      console.warn('[Storage] Failed to load settings:', e);
      return { ...DEFAULTS };
    }
  }

  /**
   * Save settings to localStorage
   */
  function save(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('[Storage] Failed to save settings:', e);
    }
  }

  /**
   * Clear all saved settings
   */
  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CACHE_KEY);
    } catch (e) {
      console.warn('[Storage] Failed to clear:', e);
    }
  }

  /**
   * Get default settings (fresh copy)
   */
  function getDefaults() {
    return { ...DEFAULTS };
  }

  /**
   * Cache API responses (sessionStorage-like, but in localStorage with TTL)
   */
  function cacheSet(key, data, ttlMinutes = 60) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      cache[key] = {
        data,
        expires: Date.now() + ttlMinutes * 60 * 1000,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn('[Storage] Cache write failed:', e);
    }
  }

  /**
   * Retrieve cached API response (returns null if expired or missing)
   */
  function cacheGet(key) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const entry = cache[key];
      if (!entry) return null;
      if (Date.now() > entry.expires) {
        delete cache[key];
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        return null;
      }
      return entry.data;
    } catch (e) {
      return null;
    }
  }

  /**
   * Create a debounced version of save
   */
  let saveTimer = null;
  function debouncedSave(settings, delay = 500) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(settings), delay);
  }

  return {
    load,
    save,
    debouncedSave,
    clear,
    getDefaults,
    cacheSet,
    cacheGet,
    DEFAULTS,
  };
})();
