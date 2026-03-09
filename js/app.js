/**
 * app.js — Main application controller for PHEV Cost Calculator
 * 
 * Handles:
 *  - State management & initialization
 *  - Event listeners for all inputs
 *  - Rendering & DOM updates
 *  - Dynamic table generation
 *  - API orchestration
 */

const App = (() => {
  // --- Application State ---
  let state = {};
  let nordPoolData = null; // Cached Nord Pool response

  // --- DOM Element References ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // =========================================================
  //  INITIALIZATION
  // =========================================================

  function init() {
    state = Storage.load();
    bindInputs();
    bindActions();
    populateInputsFromState();
    recalculateAll();
    fetchExternalData();
  }

  // =========================================================
  //  INPUT BINDING
  // =========================================================

  /**
   * Bind all input elements to state and trigger recalculation
   */
  function bindInputs() {
    // -- Vehicle config --
    bindNumericInput('#batteryCapacity', 'batteryCapacity');
    bindNumericInput('#electricRangeSummer', 'electricRangeSummer');
    bindNumericInput('#electricRangeWinter', 'electricRangeWinter');
    bindNumericInput('#manualRange', 'manualRange');
    bindNumericInput('#fuelConsumption', 'fuelConsumption');

    // Manual range checkbox
    const manualRangeCheck = $('#useManualRange');
    if (manualRangeCheck) {
      manualRangeCheck.addEventListener('change', (e) => {
        state.useManualRange = e.target.checked;
        $('#manualRange').disabled = !e.target.checked;
        saveAndRecalc();
      });
    }

    // Season toggle
    $$('.season-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.season-toggle').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.season = btn.dataset.season;
        saveAndRecalc();
      });
    });

    // -- Fuel --
    bindNumericInput('#fuelPrice', 'fuelPrice');

    // -- Electricity: home --
    bindNumericInput('#homeElectricityPrice', 'homeElectricityPrice');
    bindNumericInput('#vatRate', 'vatRate');

    const dynamicFeeToggle = $('#dynamicFeeEnabled');
    if (dynamicFeeToggle) {
      dynamicFeeToggle.addEventListener('change', (e) => {
        state.dynamicFeeEnabled = e.target.checked;
        saveAndRecalc();
      });
    }

    const vatToggle = $('#vatEnabled');
    if (vatToggle) {
      vatToggle.addEventListener('change', (e) => {
        state.vatEnabled = e.target.checked;
        saveAndRecalc();
      });
    }

    // Electricity source toggle (manual vs nordpool)
    $$('.elec-source-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.elec-source-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.electricitySource = btn.dataset.source;
        updateElectricitySourceUI();
        saveAndRecalc();
      });
    });

    // Nord Pool hour selector
    const hourSelect = $('#nordpoolHourSelect');
    if (hourSelect) {
      hourSelect.addEventListener('change', (e) => {
        state.selectedNordPoolHour = e.target.value;
        const rangePicker = $('#nordpoolRangePicker');
        if (rangePicker) rangePicker.classList.toggle('hidden', e.target.value !== 'range');
        if (e.target.value === 'range') updateRangeAvgDisplay();
        highlightSelectedHour(e.target.value);
        saveAndRecalc();
      });
    }

    // Nord Pool range pickers
    const rangeStartSel = $('#rangeStart');
    if (rangeStartSel) {
      rangeStartSel.addEventListener('change', (e) => {
        state.rangeStart = parseInt(e.target.value, 10);
        updateRangeAvgDisplay();
        saveAndRecalc();
      });
    }
    const rangeEndSel = $('#rangeEnd');
    if (rangeEndSel) {
      rangeEndSel.addEventListener('change', (e) => {
        state.rangeEnd = parseInt(e.target.value, 10);
        updateRangeAvgDisplay();
        saveAndRecalc();
      });
    }

    // -- Electricity: public --
    bindNumericInput('#publicChargingPrice', 'publicChargingPrice');
    bindNumericInput('#publicSessionFee', 'publicSessionFee');

    // -- SOC Calculator --
    bindRangeInput('#socStart', 'socStart', '#socStartVal');
    bindRangeInput('#socTarget', 'socTarget', '#socTargetVal');

    $$('.soc-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.soc-type-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.socChargeType = btn.dataset.type;
        saveAndRecalc();
      });
    });

    // -- Nord Pool JSON paste fallback --
    const pasteBtn = $('#parseNordpoolJson');
    if (pasteBtn) {
      pasteBtn.addEventListener('click', () => {
        const json = $('#nordpoolJsonInput').value.trim();
        if (!json) return;
        const result = Api.parseNordPoolJson(json);
        if (result.error) {
          showNordPoolError(result.error);
        } else {
          nordPoolData = result;
          renderNordPoolCard();
          updateNordPoolHourSelector();
          recalculateAll();
        }
      });
    }
  }

  /**
   * Helper: bind a numeric input to a state key
   */
  function bindNumericInput(selector, stateKey) {
    const el = $(selector);
    if (!el) return;
    el.addEventListener('input', (e) => {
      const val = e.target.value;
      // Allow empty string (user clearing field)
      state[stateKey] = val === '' ? '' : parseFloat(val);
      validateInput(el, stateKey);
      saveAndRecalc();
    });
  }

  /**
   * Helper: bind a range slider to state
   */
  function bindRangeInput(selector, stateKey, displaySelector) {
    const el = $(selector);
    if (!el) return;
    el.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      state[stateKey] = val;
      if (displaySelector) {
        const displayEl = $(displaySelector);
        if (displayEl) displayEl.textContent = val + '%';
      }
      // Validate SOC: start must be < target
      if (stateKey === 'socStart' && val >= state.socTarget) {
        state.socTarget = Math.min(val + 10, 100);
        const targetEl = $('#socTarget');
        if (targetEl) targetEl.value = state.socTarget;
        const targetDisplay = $('#socTargetVal');
        if (targetDisplay) targetDisplay.textContent = state.socTarget + '%';
      }
      if (stateKey === 'socTarget' && val <= state.socStart) {
        state.socStart = Math.max(val - 10, 0);
        const startEl = $('#socStart');
        if (startEl) startEl.value = state.socStart;
        const startDisplay = $('#socStartVal');
        if (startDisplay) startDisplay.textContent = state.socStart + '%';
      }
      saveAndRecalc();
    });
  }

  // =========================================================
  //  ACTION BUTTONS
  // =========================================================

  function bindActions() {
    // Reset settings
    const resetBtn = $('#resetSettings');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Reset all settings to defaults?')) {
          Storage.clear();
          state = Storage.getDefaults();
          populateInputsFromState();
          recalculateAll();
        }
      });
    }

    // Refresh Nord Pool
    const refreshNP = $('#refreshNordPool');
    if (refreshNP) {
      refreshNP.addEventListener('click', () => {
        Storage.cacheSet('nordpool-prices', null, 0);
        fetchNordPoolPrices();
      });
    }
  }

  // =========================================================
  //  POPULATE UI FROM STATE
  // =========================================================

  function populateInputsFromState() {
    setInputVal('#batteryCapacity', state.batteryCapacity);
    setInputVal('#electricRangeSummer', state.electricRangeSummer);
    setInputVal('#electricRangeWinter', state.electricRangeWinter);
    setInputVal('#manualRange', state.manualRange);
    setInputVal('#fuelConsumption', state.fuelConsumption);
    setInputVal('#fuelPrice', state.fuelPrice);
    setInputVal('#homeElectricityPrice', state.homeElectricityPrice);
    setInputVal('#vatRate', state.vatRate);
    setInputVal('#publicChargingPrice', state.publicChargingPrice);
    setInputVal('#publicSessionFee', state.publicSessionFee);

    // Checkboxes
    const manualRangeCheck = $('#useManualRange');
    if (manualRangeCheck) {
      manualRangeCheck.checked = state.useManualRange;
      const rangeInput = $('#manualRange');
      if (rangeInput) rangeInput.disabled = !state.useManualRange;
    }

    const vatToggle = $('#vatEnabled');
    if (vatToggle) vatToggle.checked = state.vatEnabled;

    const dynamicFeeToggle = $('#dynamicFeeEnabled');
    if (dynamicFeeToggle) dynamicFeeToggle.checked = state.dynamicFeeEnabled;

    // Season toggle
    $$('.season-toggle').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.season === state.season);
    });

    // Electricity source
    $$('.elec-source-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.source === state.electricitySource);
    });
    updateElectricitySourceUI();

    // Nord Pool range picker
    const rangeStartEl = $('#rangeStart');
    if (rangeStartEl) rangeStartEl.value = state.rangeStart;
    const rangeEndEl = $('#rangeEnd');
    if (rangeEndEl) rangeEndEl.value = state.rangeEnd;
    const rangePicker = $('#nordpoolRangePicker');
    if (rangePicker) rangePicker.classList.toggle('hidden', state.selectedNordPoolHour !== 'range');

    // SOC sliders
    const socStart = $('#socStart');
    if (socStart) { socStart.value = state.socStart; }
    const socStartVal = $('#socStartVal');
    if (socStartVal) socStartVal.textContent = state.socStart + '%';

    const socTarget = $('#socTarget');
    if (socTarget) { socTarget.value = state.socTarget; }
    const socTargetVal = $('#socTargetVal');
    if (socTargetVal) socTargetVal.textContent = state.socTarget + '%';

    // SOC charge type
    $$('.soc-type-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.type === state.socChargeType);
    });
  }

  function setInputVal(selector, value) {
    const el = $(selector);
    if (el) el.value = value === '' || value === undefined || value === null ? '' : value;
  }

  function updateElectricitySourceUI() {
    const manualSection = $('#elecManualSection');
    const nordpoolSection = $('#elecNordpoolSection');
    if (manualSection && nordpoolSection) {
      if (state.electricitySource === 'manual') {
        manualSection.classList.remove('hidden');
        nordpoolSection.classList.add('hidden');
      } else {
        manualSection.classList.add('hidden');
        nordpoolSection.classList.remove('hidden');
      }
    }
  }

  // =========================================================
  //  VALIDATION
  // =========================================================

  function validateInput(el, key) {
    const val = state[key];
    let isValid = true;
    let errorMsg = '';

    if (val !== '' && val !== undefined) {
      if (typeof val === 'number' && isNaN(val)) {
        isValid = false;
        errorMsg = 'Must be a number';
      } else if (typeof val === 'number' && val < 0) {
        isValid = false;
        errorMsg = 'Cannot be negative';
      }
    }

    el.classList.toggle('input-error', !isValid);
    const errEl = el.parentElement.querySelector('.error-text');
    if (errEl) {
      errEl.textContent = errorMsg;
      errEl.style.display = isValid ? 'none' : 'block';
    }
    return isValid;
  }

  // =========================================================
  //  RECALCULATION
  // =========================================================

  function saveAndRecalc() {
    Storage.debouncedSave(state);
    recalculateAll();
  }

  function recalculateAll() {
    const s = state;

    // Determine effective battery capacity
    const battery = getNumOrNull(s.batteryCapacity) || 0;

    // Determine electric range
    let range = 0;
    if (s.useManualRange && getNumOrNull(s.manualRange)) {
      range = s.manualRange;
    } else if (s.season === 'winter') {
      range = getNumOrNull(s.electricRangeWinter) || 0;
    } else {
      range = getNumOrNull(s.electricRangeSummer) || 0;
    }

    const efficiency = 100;

    // --- Home electricity price ---
    let homeSpotPrice = 0;
    if (s.electricitySource === 'nordpool' && nordPoolData && nordPoolData.prices.length > 0) {
      if (s.selectedNordPoolHour === 'average' && nordPoolData.stats) {
        homeSpotPrice = nordPoolData.stats.average;
      } else if (s.selectedNordPoolHour === 'range') {
        const rs = parseInt(s.rangeStart, 10);
        const re = parseInt(s.rangeEnd, 10);
        const hoursInRange = nordPoolData.prices.filter((_, i) => {
          if (rs <= re) return i >= rs && i <= re;
          return i >= rs || i <= re; // overnight wrap
        });
        if (hoursInRange.length > 0) {
          homeSpotPrice = hoursInRange.reduce((sum, p) => sum + p.valueKwh, 0) / hoursInRange.length;
        } else if (nordPoolData.stats) {
          homeSpotPrice = nordPoolData.stats.average;
        }
      } else {
        const hourIdx = parseInt(s.selectedNordPoolHour, 10);
        if (!isNaN(hourIdx) && nordPoolData.prices[hourIdx]) {
          homeSpotPrice = nordPoolData.prices[hourIdx].valueKwh;
        } else if (nordPoolData.stats) {
          homeSpotPrice = nordPoolData.stats.average;
        }
      }
    } else {
      homeSpotPrice = getNumOrNull(s.homeElectricityPrice) || 0;
    }

    // Calculate total home electricity price (spot + surcharges)
    let homeTotalPrice;
    if (s.electricitySource === 'nordpool') {
      const dynamicFee = s.dynamicFeeEnabled ? (getNumOrNull(s.dynamicFee) || 0) : 0;
      homeTotalPrice = Calc.totalElectricityPrice(
        homeSpotPrice,
        dynamicFee,
        s.vatEnabled,
        getNumOrNull(s.vatRate) || 0
      );
    } else {
      // Manual mode: price already includes everything the user typed
      homeTotalPrice = homeSpotPrice;
    }

    const homeEffective = Calc.effectiveKwhPrice(homeTotalPrice);

    // --- Public electricity price ---
    const publicPrice = getNumOrNull(s.publicChargingPrice) || 0;
    const publicEffective = Calc.effectiveKwhPrice(publicPrice);

    // --- Fuel ---
    const fuelPrice = getNumOrNull(s.fuelPrice) || 0;
    const fuelConsumption = getNumOrNull(s.fuelConsumption) || 0;

    // --- Costs per 100km ---
    const costElecHome = Calc.electricCostPer100km(battery, range, homeEffective);
    const costElecPublic = Calc.electricCostPer100km(battery, range, publicEffective);
    const costFuel = Calc.fuelCostPer100km(fuelConsumption, fuelPrice);

    // --- Break-even ---
    const breakEven = Calc.breakEvenPrice(costFuel, range, battery);

    // --- SOC charge cost ---
    const socPrice = s.socChargeType === 'public' ? publicEffective : homeEffective;
    const socSessionFee = s.socChargeType === 'public' ? (getNumOrNull(s.publicSessionFee) || 0) : 0;
    const socResult = Calc.chargingCostBySoc(battery, s.socStart, s.socTarget, socPrice, range, socSessionFee);

    // --- Sensitivity table ---
    const sensDynamicFee = s.dynamicFeeEnabled ? (getNumOrNull(s.dynamicFee) || 0) : 0;
    const sensitivity = Calc.sensitivityTable(
      battery, range, costFuel,
      sensDynamicFee, s.vatEnabled, getNumOrNull(s.vatRate) || 0
    );

    // --- Render everything ---
    renderCostCards(costElecHome, costElecPublic, costFuel);
    renderBreakEven(breakEven, homeTotalPrice, costFuel > 0 && costElecHome > 0);
    renderSocResult(socResult);
    renderSensitivityTable(sensitivity, costFuel, homeTotalPrice, publicPrice);
    renderTotalElectricityPrice(homeTotalPrice);
    renderConsumptionInfo(battery, range);
    renderTimestamp();
  }

  function getNumOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  // =========================================================
  //  RENDER FUNCTIONS
  // =========================================================

  function renderCostCards(home, pub, fuel) {
    const homeEl = $('#costElecHome');
    const pubEl = $('#costElecPublic');
    const fuelEl = $('#costFuel');

    if (homeEl) homeEl.textContent = home > 0 ? Calc.formatEur(home) : '—';
    if (pubEl) pubEl.textContent = pub > 0 ? Calc.formatEur(pub) : '—';
    if (fuelEl) fuelEl.textContent = fuel > 0 ? Calc.formatEur(fuel) : '—';

    // Highlight cheapest
    const cards = $$('.cost-card');
    cards.forEach((c) => c.classList.remove('cheapest'));

    const costs = [
      { val: home, el: cards[0] },
      { val: pub, el: cards[1] },
      { val: fuel, el: cards[2] },
    ].filter((c) => c.val > 0 && c.el);

    if (costs.length > 0) {
      const cheapest = costs.reduce((a, b) => (a.val < b.val ? a : b));
      cheapest.el.classList.add('cheapest');
    }
  }

  function renderBreakEven(breakEvenPrice, currentPrice, hasData) {
    const container = $('#breakevenIndicator');
    if (!container) return;

    if (!hasData || breakEvenPrice <= 0) {
      container.className = 'breakeven-indicator';
      container.innerHTML = `
        <div class="breakeven-status">⚡</div>
        <div class="breakeven-details">
          <div class="title">Enter vehicle data to see break-even analysis</div>
          <div class="prices">
            <span>Fill in battery capacity, range, fuel consumption, and prices</span>
          </div>
        </div>`;
      return;
    }

    const isElecCheaper = currentPrice <= breakEvenPrice;
    container.className = `breakeven-indicator ${isElecCheaper ? 'cheaper-electric' : 'cheaper-fuel'}`;

    container.innerHTML = `
      <div class="breakeven-status">${isElecCheaper ? '⚡' : '⛽'}</div>
      <div class="breakeven-details">
        <div class="title">${isElecCheaper ?
          'Electric driving is cheaper than fuel' :
          'Electricity currently more expensive than fuel'}</div>
        <div class="prices">
          <span>
            Break-even price
            <span class="value">${Calc.formatKwhPrice(breakEvenPrice)}</span>
          </span>
          <span>
            Current price
            <span class="value">${Calc.formatKwhPrice(currentPrice)}</span>
          </span>
        </div>
      </div>`;
  }

  function renderSocResult(result) {
    const kwhEl = $('#socKwh');
    const costEl = $('#socCost');
    const kmEl = $('#socKm');
    if (kwhEl) kwhEl.textContent = result.kwhAdded > 0 ? `${result.kwhAdded} kWh` : '—';
    if (costEl) costEl.textContent = result.cost > 0 ? Calc.formatEur(result.cost) : '—';
    if (kmEl) kmEl.textContent = result.estimatedKmAdded > 0 ? `${result.estimatedKmAdded} km` : '—';
  }

  function renderSensitivityTable(data, fuelCost, currentPrice, publicChargePrice) {
    const tbody = $('#sensitivityBody');
    if (!tbody) return;

    tbody.innerHTML = data.map((row) => {
      let rowClass = '';
      if (row.isBreakEven) rowClass = 'break-even-row';
      else if (row.cheaperThanFuel) rowClass = 'below-breakeven';
      else if (row.homeCost > 0) rowClass = 'above-breakeven';

      // Highlight row whose effective home price is closest to current home price
      const isNearCurrent = currentPrice > 0 &&
        Math.abs(row.homeEffective - currentPrice) < 0.0126;
      if (isNearCurrent) rowClass += ' current-price-row';

      const homeStr  = row.homeCost > 0 ? Calc.formatEur(row.homeCost) : '—';
      // Only show public cost for rows at or above the configured public charging price
      const pubStr   = (row.publicCost > 0 && publicChargePrice > 0 && row.price >= publicChargePrice - 0.001)
        ? Calc.formatEur(row.publicCost) : '—';
      const cheapStr = row.homeCost > 0 ? (row.cheaperThanFuel ? '✅ Yes' : '❌ No') : '—';

      return `<tr class="${rowClass}">
        <td>${Calc.formatKwhPrice(row.price)}</td>
        <td>${homeStr}</td>
        <td>${pubStr}</td>
        <td>${cheapStr}</td>
      </tr>`;
    }).join('');

    // Footer: fuel reference
    const tfoot = $('#sensitivityFoot');
    if (tfoot) {
      tfoot.innerHTML = `<tr>
        <td colspan="3" style="font-weight:600">⛽ Fuel cost per 100km</td>
        <td style="font-weight:700; font-family: var(--font-mono)">${fuelCost > 0 ? Calc.formatEur(fuelCost) : '—'}</td>
      </tr>`;
    }
  }

  function renderTotalElectricityPrice(totalPrice) {
    const el = $('#totalElecPrice');
    if (el) el.textContent = totalPrice > 0 ? Calc.formatKwhPrice(totalPrice) : '—';
  }

  function renderConsumptionInfo(battery, range) {
    const el = $('#consumptionInfo');
    if (!el) return;
    if (battery > 0 && range > 0) {
      const consumption = Calc.electricConsumptionPer100km(battery, range);
      el.textContent = `${consumption.toFixed(1)} kWh/100km`;
    } else {
      el.textContent = 'Enter vehicle data above';
    }
  }

  function renderTimestamp() {
    const el = $('#lastUpdated');
    if (el) {
      el.textContent = `Updated: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    }
  }

  // =========================================================
  //  NORD POOL CARD RENDERING
  // =========================================================

  function renderNordPoolCard() {
    if (!nordPoolData || !nordPoolData.prices.length) return;

    const { prices, stats, date } = nordPoolData;

    // Summary stats
    const minEl = $('#npMin');
    const maxEl = $('#npMax');
    const avgEl = $('#npAvg');
    if (minEl) minEl.textContent = stats ? Calc.formatKwhPrice(stats.min) : '—';
    if (maxEl) maxEl.textContent = stats ? Calc.formatKwhPrice(stats.max) : '—';
    if (avgEl) avgEl.textContent = stats ? Calc.formatKwhPrice(stats.average) : '—';

    // Date
    const dateEl = $('#npDate');
    if (dateEl) dateEl.textContent = date ? `Prices for: ${date}` : '';

    // Hourly table
    const tbody = $('#nordpoolBody');
    if (tbody) {
      tbody.innerHTML = prices.map((p, i) => {
        const hour = Api.formatHour(p.start);
        const isMin = stats && p.valueKwh === stats.min;
        const isMax = stats && p.valueKwh === stats.max;
        let cls = '';
        if (isMin) cls = 'below-breakeven';
        if (isMax) cls = 'above-breakeven';
        return `<tr class="${cls}" data-hour="${i}">
          <td>${hour}</td>
          <td style="font-family: var(--font-mono)">${p.valueKwh.toFixed(4)}</td>
          <td>${isMin ? '🟢 Min' : isMax ? '🔴 Max' : ''}</td>
        </tr>`;
      }).join('');

      // Click to select hour
      tbody.querySelectorAll('tr').forEach((tr) => {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => {
          const hourIdx = tr.dataset.hour;
          state.selectedNordPoolHour = hourIdx;
          const sel = $('#nordpoolHourSelect');
          if (sel) sel.value = hourIdx;
          // Hide range picker when switching back to a specific hour
          const rp = $('#nordpoolRangePicker');
          if (rp) rp.classList.add('hidden');
          highlightSelectedHour(hourIdx);
          saveAndRecalc();
        });
      });
    }

    // Populate hour selector dropdown
    updateNordPoolHourSelector();
    if (state.selectedNordPoolHour === 'range') updateRangeAvgDisplay();

    // Hide fallback if we have data, show table
    const fallback = $('#nordpoolFallback');
    if (fallback) fallback.classList.add('hidden');

    const tableSection = $('#nordpoolTableSection');
    if (tableSection) tableSection.classList.remove('hidden');

    // VAT notice
    const vatNotice = $('#npVatNotice');
    if (vatNotice) {
      vatNotice.textContent = nordPoolData.vatIncluded ?
        'Prices include VAT' : 'Prices exclude VAT (spot only)';
    }
  }

  function updateNordPoolHourSelector() {
    const sel = $('#nordpoolHourSelect');
    if (!sel || !nordPoolData) return;

    sel.innerHTML = '<option value="average">Daily Average</option><option value="range">📅 Custom Range...</option>';
    nordPoolData.prices.forEach((p, i) => {
      const hour = Api.formatHour(p.start);
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${hour} — ${p.valueKwh.toFixed(4)} €/kWh`;
      sel.appendChild(opt);
    });

    sel.value = state.selectedNordPoolHour;
    // Ensure range picker visibility matches current selection
    const rangePicker = $('#nordpoolRangePicker');
    if (rangePicker) rangePicker.classList.toggle('hidden', state.selectedNordPoolHour !== 'range');
    highlightSelectedHour(state.selectedNordPoolHour);
  }

  function highlightSelectedHour(hourIdx) {
    const tbody = $('#nordpoolBody');
    if (!tbody) return;
    if (state.selectedNordPoolHour === 'range') {
      const rs = parseInt(state.rangeStart, 10);
      const re = parseInt(state.rangeEnd, 10);
      tbody.querySelectorAll('tr').forEach((tr) => {
        const i = parseInt(tr.dataset.hour, 10);
        const inRange = rs <= re ? (i >= rs && i <= re) : (i >= rs || i <= re);
        tr.classList.remove('selected-hour');
        tr.classList.toggle('in-range-row', inRange);
      });
    } else {
      tbody.querySelectorAll('tr').forEach((tr) => {
        tr.classList.remove('in-range-row');
        tr.classList.toggle('selected-hour', tr.dataset.hour === String(hourIdx));
      });
    }
  }

  function updateRangeAvgDisplay() {
    const avgEl = $('#rangeAvgValue');
    const countEl = $('#rangeHoursCount');
    if (!avgEl) return;
    if (!nordPoolData || !nordPoolData.prices.length) {
      avgEl.textContent = '—';
      if (countEl) countEl.textContent = '';
      return;
    }
    const rs = parseInt(state.rangeStart, 10);
    const re = parseInt(state.rangeEnd, 10);
    const hoursInRange = nordPoolData.prices.filter((_, i) => {
      if (rs <= re) return i >= rs && i <= re;
      return i >= rs || i <= re; // overnight wrap
    });
    if (hoursInRange.length === 0) {
      avgEl.textContent = '—';
      if (countEl) countEl.textContent = '';
      return;
    }
    const avg = hoursInRange.reduce((sum, p) => sum + p.valueKwh, 0) / hoursInRange.length;
    avgEl.textContent = Calc.formatKwhPrice(Calc.round(avg, 5));
    if (countEl) {
      const fromH = rs.toString().padStart(2, '0') + ':00';
      const toH = re.toString().padStart(2, '0') + ':00';
      const overnight = rs > re ? ' ★ overnight' : '';
      countEl.textContent = `(${hoursInRange.length}h: ${fromH}–${toH}${overnight})`;
    }
    highlightSelectedHour('range');
  }

  function showNordPoolError(msg) {
    const errEl = $('#nordpoolError');
    if (errEl) {
      errEl.innerHTML = `<span class="icon">⚠️</span><span>${msg}</span>`;
      errEl.classList.remove('hidden');
    }
  }

  // =========================================================
  //  EXTERNAL DATA FETCHING
  // =========================================================

  async function fetchExternalData() {
    await fetchNordPoolPrices();
  }

  async function fetchNordPoolPrices() {
    const statusEl = $('#npFetchStatus');
    if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Fetching Nord Pool...';

    const result = await Api.fetchNordPoolPrices();

    if (result.prices && result.prices.length > 0) {
      nordPoolData = result;
      renderNordPoolCard();
      if (statusEl) {
        statusEl.innerHTML = `<span class="badge badge--success">✓ ${result.source === 'cached' ? 'Cached' : 'Live'} (${result.prices.length}h)</span>`;
      }
    } else {
      if (statusEl) {
        statusEl.innerHTML = `<span class="badge badge--warning">⚠ ${result.error || 'No data'}</span>`;
      }
      // Show fallback section
      const fallback = $('#nordpoolFallback');
      if (fallback) fallback.classList.remove('hidden');
      showNordPoolError(result.error || 'Could not load prices');
    }

    recalculateAll();
  }

  // =========================================================
  //  START
  // =========================================================

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { state, recalculateAll };
})();
