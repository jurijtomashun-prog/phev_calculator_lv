/**
 * api.js — External data fetching for PHEV Cost Calculator
 * 
 * Handles:
 *  - Nord Pool electricity spot prices via nordpool.didnt.work (Latvia)
 *  - CORS fallback logic and caching
 */

const Api = (() => {

  // --- Configuration ---
  const NORDPOOL_URL = 'https://nordpool.didnt.work/api/lv/prices';
  const FETCH_TIMEOUT = 10000; // 10s

  /**
   * Fetch with timeout wrapper
   */
  async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return response;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  /**
   * Fetch today's Nord Pool hourly electricity prices for Latvia
   * 
   * @returns {Promise<{ prices: Array, stats: Object, date: string, error: string|null }>}
   */
  async function fetchNordPoolPrices() {
    // Check cache (valid for 30 min — prices update once daily around noon)
    const cached = Storage.cacheGet('nordpool-prices');
    if (cached) {
      return { ...cached, source: 'cached', error: null };
    }

    try {
      const url = `${NORDPOOL_URL}?resolution=60`;
      const response = await fetchWithTimeout(url);

      if (response.status === 429) {
        throw new Error('Rate limited (429). Please try again later.');
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      if (!data.prices || !Array.isArray(data.prices)) {
        throw new Error('Invalid response format');
      }

      // Convert prices and build result
      const hourlyPrices = data.prices.map((p) => ({
        start: p.start,
        end: p.end,
        valueMwh: p.value,
        valueKwh: Calc.round(p.value / 1000, 5), // EUR/MWh → EUR/kWh
      }));

      const stats = Calc.nordPoolStats(data.prices);
      const result = {
        prices: hourlyPrices,
        stats,
        date: data.date,
        unit: 'EUR/kWh',
        vatIncluded: data.vat_included || false,
      };

      Storage.cacheSet('nordpool-prices', result, 30); // Cache 30 min
      return { ...result, source: 'fetched', error: null };

    } catch (e) {
      console.warn('[API] Nord Pool fetch failed:', e.message);
      return {
        prices: [],
        stats: null,
        date: null,
        source: 'failed',
        error: e.name === 'AbortError' ? 'Request timed out' :
               e.message.includes('Failed to fetch') ? 'CORS or network error — use manual input or paste JSON below' :
               e.message,
      };
    }
  }

  /**
   * Parse manually pasted Nord Pool JSON (fallback for CORS issues)
   * Expects the same format as nordpool.didnt.work response
   * 
   * @param {string} jsonString - Raw JSON string pasted by user
   * @returns {{ prices: Array, stats: Object, date: string, error: string|null }}
   */
  function parseNordPoolJson(jsonString) {
    try {
      const data = JSON.parse(jsonString);

      if (!data.prices || !Array.isArray(data.prices)) {
        return { prices: [], stats: null, date: null, error: 'Invalid format: missing "prices" array' };
      }

      const hourlyPrices = data.prices.map((p) => ({
        start: p.start,
        end: p.end,
        valueMwh: p.value,
        valueKwh: Calc.round(p.value / 1000, 5),
      }));

      const stats = Calc.nordPoolStats(data.prices);

      return {
        prices: hourlyPrices,
        stats,
        date: data.date || 'Unknown',
        unit: 'EUR/kWh',
        vatIncluded: data.vat_included || false,
        error: null,
      };
    } catch (e) {
      return { prices: [], stats: null, date: null, error: 'Invalid JSON: ' + e.message };
    }
  }

  /**
   * Get the hour label from an ISO timestamp
   * e.g. "2026-02-25T14:00:00+02:00" → "14:00"
   */
  function formatHour(isoString) {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return isoString;
    }
  }

  return {
    fetchNordPoolPrices,
    parseNordPoolJson,
    formatHour,
  };
})();
