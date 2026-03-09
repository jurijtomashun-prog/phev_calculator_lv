/**
 * calculations.js — All PHEV cost calculation formulas
 * 
 * Pure functions with no side effects.
 * All monetary values in EUR, energy in kWh, distance in km.
 */

const Calc = (() => {

  /**
   * Effective electricity price
   * Charging efficiency is not applied (price already includes real-world losses).
   * @param {number} pricePerKwh - Electricity price in EUR/kWh
   * @returns {number} Effective price per kWh delivered to battery
   */
  function effectiveKwhPrice(pricePerKwh) {
    return pricePerKwh || 0;
  }

  /**
   * Cost to drive 100km on electricity
   * @param {number} batteryKwh - Battery capacity in kWh
   * @param {number} rangeKm - Electric range in km
   * @param {number} effectivePrice - Effective EUR/kWh (after efficiency loss)
   * @returns {number} Cost in EUR per 100km
   */
  function electricCostPer100km(batteryKwh, rangeKm, effectivePrice) {
    if (!rangeKm || rangeKm <= 0 || !batteryKwh) return 0;
    const kwhPer100km = (batteryKwh / rangeKm) * 100;
    return kwhPer100km * effectivePrice;
  }

  /**
   * Electric consumption in kWh per 100km
   * @param {number} batteryKwh - Battery capacity
   * @param {number} rangeKm - Range in km
   * @returns {number} kWh/100km
   */
  function electricConsumptionPer100km(batteryKwh, rangeKm) {
    if (!rangeKm || rangeKm <= 0 || !batteryKwh) return 0;
    return (batteryKwh / rangeKm) * 100;
  }

  /**
   * Cost to drive 100km on fuel
   * @param {number} consumptionLPer100km - Fuel consumption in L/100km
   * @param {number} fuelPricePerLiter - Fuel price in EUR/L
   * @returns {number} Cost in EUR per 100km
   */
  function fuelCostPer100km(consumptionLPer100km, fuelPricePerLiter) {
    if (!consumptionLPer100km || !fuelPricePerLiter) return 0;
    return consumptionLPer100km * fuelPricePerLiter;
  }

  /**
   * Calculate charging cost for a SOC range
   * @param {number} batteryKwh - Total (or usable) battery capacity in kWh
   * @param {number} startSocPercent - Starting SOC (0-100)
   * @param {number} targetSocPercent - Target SOC (0-100)
   * @param {number} effectivePrice - Effective EUR/kWh
   * @param {number} rangeKm - Electric range for this season
   * @param {number} sessionFee - Optional fixed session fee (EUR)
   * @returns {{ kwhAdded: number, cost: number, estimatedKmAdded: number }}
   */
  function chargingCostBySoc(batteryKwh, startSocPercent, targetSocPercent, effectivePrice, rangeKm, sessionFee = 0) {
    if (!batteryKwh || startSocPercent >= targetSocPercent) {
      return { kwhAdded: 0, cost: 0, estimatedKmAdded: 0 };
    }

    const socDelta = (targetSocPercent - startSocPercent) / 100;
    const kwhAdded = batteryKwh * socDelta;
    const cost = kwhAdded * effectivePrice + sessionFee;

    // Estimated km from added energy
    let estimatedKmAdded = 0;
    if (rangeKm > 0 && batteryKwh > 0) {
      const kmPerKwh = rangeKm / batteryKwh;
      estimatedKmAdded = kwhAdded * kmPerKwh;
    }

    return {
      kwhAdded: round(kwhAdded, 2),
      cost: round(cost, 4),
      estimatedKmAdded: round(estimatedKmAdded, 1),
    };
  }

  /**
   * Break-even electricity price — the kWh price at which electric = fuel cost
   * @param {number} fuelCostPer100 - Fuel cost per 100km in EUR
   * @param {number} rangeKm - Electric range in km
   * @param {number} batteryKwh - Battery capacity in kWh
   * @returns {number} Break-even electricity price in EUR/kWh
   */
  function breakEvenPrice(fuelCostPer100, rangeKm, batteryKwh) {
    if (!batteryKwh || !rangeKm || rangeKm <= 0) return 0;
    const kwhPer100km = (batteryKwh / rangeKm) * 100;
    if (kwhPer100km <= 0) return 0;
    return (fuelCostPer100 / kwhPer100km);
  }

  /**
   * Calculate total consumer electricity price from components
   * @param {number} spotPrice - Nord Pool spot price EUR/kWh
   * @param {number} dynamicFee - Dynamic tariff fee EUR/kWh (e.g. 0.039)
   * @param {boolean} vatEnabled - Whether to apply VAT
   * @param {number} vatRatePercent - VAT rate (e.g. 21)
   * @returns {number} Total price EUR/kWh
   */
  function totalElectricityPrice(spotPrice, dynamicFee, vatEnabled, vatRatePercent) {
    let total = (spotPrice || 0) + (dynamicFee || 0);
    if (vatEnabled && vatRatePercent > 0) {
      total *= (1 + vatRatePercent / 100);
    }
    return total;
  }

  /**
   * Generate sensitivity table data
   * @param {number} batteryKwh
   * @param {number} rangeKm
   * @param {number} fuelCostPer100
   * @param {number} dynamicFee      - Dynamic tariff surcharge EUR/kWh (0 if disabled)
   * @param {boolean} vatEnabled     - Whether VAT is applied to home price
   * @param {number} vatRatePercent  - VAT rate (e.g. 21)
   * @returns {Array<{ price, homeEffective, homeCost, publicCost, cheaperThanFuel, isBreakEven }>}
   */
  function sensitivityTable(batteryKwh, rangeKm, fuelCostPer100, dynamicFee, vatEnabled, vatRatePercent) {
    // Prices from 0.025 to 1.00, step 0.025 (includes every 5-cent mark)
    const prices = [];
    for (let p = 0.025; p <= 1.0001; p += 0.025) {
      prices.push(round(p, 3));
    }
    let crossedBreakEven = false;

    return prices.map((price) => {
      // Home: spot price + dynamic tariff fee + VAT
      const homeEffective = totalElectricityPrice(price, dynamicFee || 0, vatEnabled, vatRatePercent || 0);
      // Public: price shown at charger is already all-in (no extra surcharges)
      const publicEffective = price;

      const homeCost = electricCostPer100km(batteryKwh, rangeKm, homeEffective);
      const publicCost = electricCostPer100km(batteryKwh, rangeKm, publicEffective);
      const cheaperThanFuel = homeCost < fuelCostPer100 && homeCost > 0;

      // Mark the first row where home cost crosses above fuel cost (break-even boundary)
      let isBreakEven = false;
      if (!crossedBreakEven && !cheaperThanFuel && homeCost > 0) {
        isBreakEven = true;
        crossedBreakEven = true;
      }

      return {
        price,
        homeEffective: round(homeEffective, 5),
        homeCost: round(homeCost, 2),
        publicCost: round(publicCost, 2),
        cheaperThanFuel,
        isBreakEven,
      };
    });
  }

  /**
   * Nord Pool price statistics
   * @param {Array<{ value: number }>} hourlyPrices - Hourly prices in EUR/MWh
   * @returns {{ min: number, max: number, average: number, minHour: string, maxHour: string }}
   */
  function nordPoolStats(hourlyPrices) {
    if (!hourlyPrices || hourlyPrices.length === 0) {
      return { min: 0, max: 0, average: 0, minHour: '-', maxHour: '-' };
    }

    let min = Infinity, max = -Infinity, sum = 0;
    let minIdx = 0, maxIdx = 0;

    hourlyPrices.forEach((p, i) => {
      const val = p.value / 1000; // MWh → kWh
      if (val < min) { min = val; minIdx = i; }
      if (val > max) { max = val; maxIdx = i; }
      sum += val;
    });

    return {
      min: round(min, 5),
      max: round(max, 5),
      average: round(sum / hourlyPrices.length, 5),
      minHour: hourlyPrices[minIdx]?.start || '-',
      maxHour: hourlyPrices[maxIdx]?.start || '-',
    };
  }

  /**
   * Round to N decimal places
   */
  function round(val, decimals) {
    if (typeof val !== 'number' || isNaN(val)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
  }

  /**
   * Format EUR value
   */
  function formatEur(val, decimals = 2) {
    if (typeof val !== 'number' || isNaN(val)) return '—';
    return `€${val.toFixed(decimals)}`;
  }

  /**
   * Format kWh price (4 decimal places for precision)
   */
  function formatKwhPrice(val) {
    if (typeof val !== 'number' || isNaN(val)) return '—';
    return `€${val.toFixed(4)}/kWh`;
  }

  return {
    effectiveKwhPrice,
    electricCostPer100km,
    electricConsumptionPer100km,
    fuelCostPer100km,
    chargingCostBySoc,
    breakEvenPrice,
    totalElectricityPrice,
    sensitivityTable,
    nordPoolStats,
    round,
    formatEur,
    formatKwhPrice,
  };
})();
