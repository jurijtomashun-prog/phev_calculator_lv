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
   * Helper: fetch and parse prices for a single date.
   * @param {string} dateStr - "YYYY-MM-DD" or empty for today
   * @returns {Promise<{ data: Object|null, raw: Array|null }>}
   */
  async function fetchDay(dateStr) {
    const url = dateStr
      ? `${NORDPOOL_URL}/${dateStr}?resolution=60`
      : `${NORDPOOL_URL}?resolution=60`;

    const response = await fetchWithTimeout(url);
    if (response.status === 429) throw new Error('Rate limited (429). Please try again later.');
    if (!response.ok) return { data: null, raw: null };

    const data = await response.json();
    if (!data.prices || !Array.isArray(data.prices) || data.prices.length === 0) {
      return { data: null, raw: null };
    }
    return { data, raw: data.prices };
  }

  /**
   * Build a day object from raw API response
   */
  function buildDayObj(data, rawPrices) {
    const prices = rawPrices.map((p) => ({
      start: p.start,
      end: p.end,
      valueMwh: p.value,
      valueKwh: Calc.round(p.value / 1000, 5),
    }));
    const stats = Calc.nordPoolStats(rawPrices);
    const date = data.date || (rawPrices[0] && rawPrices[0].start.substring(0, 10)) || '';
    return { prices, stats, date, unit: 'EUR/kWh', vatIncluded: data.vat_included || false };
  }

  /**
   * Fetch Nord Pool hourly electricity prices for Latvia.
   * Fetches today via /api/lv/prices and tomorrow via /api/lv/prices/{date}.
   * Tomorrow data is typically available after ~13:00 EET.
   *
   * @returns {Promise<{ today: Object, tomorrow: Object|null, vatIncluded: boolean, source: string, error: string|null }>}
   */
  async function fetchNordPoolPrices() {
    const cached = Storage.cacheGet('nordpool-prices-v2');
    if (cached) {
      return { ...cached, source: 'cached', error: null };
    }

    try {
      // Fetch today
      const todayResult = await fetchDay('');
      if (!todayResult.data || !todayResult.raw) {
        throw new Error('No price data returned for today');
      }

      const todayObj = buildDayObj(todayResult.data, todayResult.raw);
      const vatIncluded = todayResult.data.vat_included || false;

      // Fetch tomorrow (separate endpoint)
      const todayDate = new Date(todayResult.raw[0].start);
      const tomorrowDate = new Date(todayDate);
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = tomorrowDate.toISOString().substring(0, 10);

      let tomorrowObj = null;
      try {
        const tomorrowResult = await fetchDay(tomorrowStr);
        if (tomorrowResult.data && tomorrowResult.raw) {
          tomorrowObj = buildDayObj(tomorrowResult.data, tomorrowResult.raw);
        }
      } catch (e) {
        console.info('[API] Tomorrow prices not available:', e.message);
      }

      const result = { today: todayObj, tomorrow: tomorrowObj, vatIncluded };

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
