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
   * Fetch Nord Pool hourly electricity prices for Latvia.
   * Makes a single API call. The API may return 24h (today only) or 48h
   * (today + tomorrow, typically after ~14:00 EET).
   * We split the result by date based on the timestamps in each price entry.
   *
   * @returns {Promise<{ today: Object, tomorrow: Object|null, vatIncluded: boolean, source: string, error: string|null }>}
   */
  async function fetchNordPoolPrices() {
    const cached = Storage.cacheGet('nordpool-prices-v2');
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

      if (!data.prices || !Array.isArray(data.prices) || data.prices.length === 0) {
        throw new Error('No price data returned');
      }

      // Convert all prices
      const allPrices = data.prices.map((p) => ({
        start: p.start,
        end: p.end,
        valueMwh: p.value,
        valueKwh: Calc.round(p.value / 1000, 5),
      }));

      // Split into days based on start timestamps
      const dayBuckets = {};
      allPrices.forEach((p) => {
        const dateKey = p.start.substring(0, 10); // "YYYY-MM-DD"
        if (!dayBuckets[dateKey]) dayBuckets[dateKey] = [];
        dayBuckets[dateKey].push(p);
      });

      const sortedDates = Object.keys(dayBuckets).sort();
      const todayDate = sortedDates[0];
      const tomorrowDate = sortedDates.length > 1 ? sortedDates[1] : null;

      const todayPrices = dayBuckets[todayDate];
      const tomorrowPrices = tomorrowDate ? dayBuckets[tomorrowDate] : null;

      // Build stats from raw MWh values per day
      const todayRaw = data.prices.filter((p) => p.start.substring(0, 10) === todayDate);
      const tomorrowRaw = tomorrowDate
        ? data.prices.filter((p) => p.start.substring(0, 10) === tomorrowDate)
        : null;

      const todayStats = Calc.nordPoolStats(todayRaw);
      const tomorrowStats = tomorrowRaw ? Calc.nordPoolStats(tomorrowRaw) : null;

      const vatIncluded = data.vat_included || false;

      const todayObj = {
        prices: todayPrices,
        stats: todayStats,
        date: todayDate,
        unit: 'EUR/kWh',
        vatIncluded,
      };

      const tomorrowObj = tomorrowPrices ? {
        prices: tomorrowPrices,
        stats: tomorrowStats,
        date: tomorrowDate,
        unit: 'EUR/kWh',
        vatIncluded,
      } : null;

      const result = {
        today: todayObj,
        tomorrow: tomorrowObj,
        vatIncluded,
      };

      Storage.cacheSet('nordpool-prices-v2', result, 30);
      return { ...result, source: 'fetched', error: null };

    } catch (e) {
      console.warn('[API] Nord Pool fetch failed:', e.message);
      return {
        today: null,
        tomorrow: null,
        vatIncluded: false,
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
