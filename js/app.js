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
          nordPoolData = {
            today: result,
            tomorrow: null,
            vatIncluded: result.vatIncluded || false,
          };
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
        Storage.cacheSet('nordpool-prices-v2', null, 0);
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
    if (s.electricitySource === 'nordpool' && nordPoolData && nordPoolData.today && nordPoolData.today.prices.length > 0) {
      if (s.selectedNordPoolHour === 'average' && nordPoolData.today.stats) {
        homeSpotPrice = nordPoolData.today.stats.average;
      } else if (s.selectedNordPoolHour === 'range') {
        const rs = parseInt(s.rangeStart, 10);
        const re = parseInt(s.rangeEnd, 10);
        const isOvernight = rs > re;

        let hoursInRange;
        if (isOvernight) {
          // Overnight range: today's hours >= start, tomorrow's hours <= end
          const todayHours = nordPoolData.today.prices.filter((_, i) => i >= rs);
          const tomorrowHours = nordPoolData.tomorrow
            ? nordPoolData.tomorrow.prices.filter((_, i) => i <= re)
            : [];
          hoursInRange = [...todayHours, ...tomorrowHours];
        } else {
          hoursInRange = nordPoolData.today.prices.filter((_, i) => i >= rs && i <= re);
        }

        if (hoursInRange.length > 0) {
          homeSpotPrice = hoursInRange.reduce((sum, p) => sum + p.valueKwh, 0) / hoursInRange.length;
        } else if (nordPoolData.today.stats) {
          homeSpotPrice = nordPoolData.today.stats.average;
        }
      } else {
        // Individual hour selection (today: "0"-"23", tomorrow: "t0"-"t23")
        const sel = String(s.selectedNordPoolHour);
        const isTomorrow = sel.startsWith('t');
        const hourIdx = isTomorrow ? parseInt(sel.substring(1), 10) : parseInt(sel, 10);
        const dayData = isTomorrow ? (nordPoolData.tomorrow || null) : nordPoolData.today;

        if (!isNaN(hourIdx) && dayData && dayData.prices[hourIdx]) {
          homeSpotPrice = dayData.prices[hourIdx].valueKwh;
        } else if (nordPoolData.today.stats) {
          homeSpotPrice = nordPoolData.today.stats.average;
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
      el.textContent = 'Enter vehicle data';
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
    if (!nordPoolData || !nordPoolData.today || !nordPoolData.today.prices.length) return;

    const todayPrices = nordPoolData.today.prices;
    const todayStats = nordPoolData.today.stats;
    const tomorrowPrices = nordPoolData.tomorrow ? nordPoolData.tomorrow.prices : null;
    const tomorrowStats = nordPoolData.tomorrow ? nordPoolData.tomorrow.stats : null;
    const hasTomorrow = !!tomorrowPrices;

    // Summary stats (today)
    const minEl = $('#npMin');
    const maxEl = $('#npMax');
    const avgEl = $('#npAvg');
    if (minEl) minEl.textContent = todayStats ? Calc.formatKwhPrice(todayStats.min) : '—';
    if (maxEl) maxEl.textContent = todayStats ? Calc.formatKwhPrice(todayStats.max) : '—';
    if (avgEl) avgEl.textContent = todayStats ? Calc.formatKwhPrice(todayStats.average) : '—';

    // Date display
    const dateEl = $('#npDate');
    if (dateEl) {
      let dateText = nordPoolData.today.date ? `Today: ${nordPoolData.today.date}` : '';
      if (hasTomorrow) {
        dateText += ` · Tomorrow: ${nordPoolData.tomorrow.date}`;
      } else {
        dateText += ' · Tomorrow: not yet available (updates ~14:00 EET)';
      }
      dateEl.textContent = dateText;
    }

    // Column headers
    const colToday = $('#npColToday');
    const colTomorrow = $('#npColTomorrow');
    if (colToday) colToday.textContent = `Today ${nordPoolData.today.date || ''}`;
    if (colTomorrow) colTomorrow.textContent = hasTomorrow
      ? `Tomorrow ${nordPoolData.tomorrow.date}` : 'Tomorrow —';

    // Hourly table — single table, 3 columns: Hour | Today | Tomorrow
    const tbody = $('#nordpoolBody');
    if (tbody) {
      const maxRows = Math.max(todayPrices.length, hasTomorrow ? tomorrowPrices.length : 24);
      let html = '';

      for (let i = 0; i < maxRows; i++) {
        const tp = todayPrices[i] || null;
        const tmrw = hasTomorrow ? (tomorrowPrices[i] || null) : null;
        const hour = String(i).padStart(2, '0') + ':00';

        // Determine row class based on today's price stats
        let rowCls = '';
        if (tp) {
          if (todayStats && tp.valueKwh === todayStats.min) rowCls = 'below-breakeven';
          if (todayStats && tp.valueKwh === todayStats.max) rowCls = 'above-breakeven';
        }

        // Today cell
        const todayVal = tp
          ? `<span style="font-family: var(--font-mono)">${tp.valueKwh.toFixed(4)}</span>`
          : '<span style="color: var(--color-text-muted)">—</span>';

        // Tomorrow cell
        let tomorrowVal;
        if (hasTomorrow && tmrw) {
          const isTmrwMin = tomorrowStats && tmrw.valueKwh === tomorrowStats.min;
          const isTmrwMax = tomorrowStats && tmrw.valueKwh === tomorrowStats.max;
          const badge = isTmrwMin ? ' 🟢' : isTmrwMax ? ' 🔴' : '';
          tomorrowVal = `<span style="font-family: var(--font-mono)">${tmrw.valueKwh.toFixed(4)}</span>${badge}`;
        } else {
          tomorrowVal = '<span style="color: var(--color-text-muted)">—</span>';
        }

        html += `<tr class="${rowCls}" data-hour="${i}">
          <td>${hour}</td>
          <td data-day="today">${todayVal}</td>
          <td data-day="tomorrow">${tomorrowVal}</td>
        </tr>`;
      }

      tbody.innerHTML = html;

      // Click: click on a today cell selects that today hour, tomorrow cell selects tomorrow hour
      tbody.querySelectorAll('tr[data-hour]').forEach((tr) => {
        const hourIdx = tr.dataset.hour;
        // Today cell
        const tdToday = tr.querySelector('td[data-day="today"]');
        if (tdToday && todayPrices[parseInt(hourIdx, 10)]) {
          tdToday.style.cursor = 'pointer';
          tdToday.addEventListener('click', (e) => {
            e.stopPropagation();
            state.selectedNordPoolHour = hourIdx;
            const sel = $('#nordpoolHourSelect');
            if (sel) sel.value = hourIdx;
            const rp = $('#nordpoolRangePicker');
            if (rp) rp.classList.add('hidden');
            highlightSelectedHour(hourIdx);
            saveAndRecalc();
          });
        }
        // Tomorrow cell
        const tdTomorrow = tr.querySelector('td[data-day="tomorrow"]');
        if (tdTomorrow && hasTomorrow && tomorrowPrices[parseInt(hourIdx, 10)]) {
          tdTomorrow.style.cursor = 'pointer';
          tdTomorrow.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = `t${hourIdx}`;
            state.selectedNordPoolHour = value;
            const sel = $('#nordpoolHourSelect');
            if (sel) sel.value = value;
            const rp = $('#nordpoolRangePicker');
            if (rp) rp.classList.add('hidden');
            highlightSelectedHour(value);
            saveAndRecalc();
          });
        }
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
    if (!sel || !nordPoolData || !nordPoolData.today) return;

    sel.innerHTML = '<option value="average">Daily Average</option><option value="range">📅 Custom Range...</option>';

    // Today separator
    const todaySep = document.createElement('option');
    todaySep.disabled = true;
    todaySep.textContent = `── Today (${nordPoolData.today.date || ''}) ──`;
    sel.appendChild(todaySep);

    nordPoolData.today.prices.forEach((p, i) => {
      const hour = Api.formatHour(p.start);
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${hour} — ${p.valueKwh.toFixed(4)} €/kWh`;
      sel.appendChild(opt);
    });

    // Tomorrow separator
    const tomorrowSep = document.createElement('option');
    tomorrowSep.disabled = true;
    tomorrowSep.textContent = nordPoolData.tomorrow
      ? `── Tomorrow (${nordPoolData.tomorrow.date || ''}) ──`
      : '── Tomorrow (not available) ──';
    sel.appendChild(tomorrowSep);

    if (nordPoolData.tomorrow) {
      nordPoolData.tomorrow.prices.forEach((p, i) => {
        const hour = Api.formatHour(p.start);
        const opt = document.createElement('option');
        opt.value = `t${i}`;
        opt.textContent = `${hour} — ${p.valueKwh.toFixed(4)} €/kWh`;
        sel.appendChild(opt);
      });
    }

    sel.value = state.selectedNordPoolHour;
    // Ensure range picker visibility matches current selection
    const rangePicker = $('#nordpoolRangePicker');
    if (rangePicker) rangePicker.classList.toggle('hidden', state.selectedNordPoolHour !== 'range');
    highlightSelectedHour(state.selectedNordPoolHour);
  }

  function highlightSelectedHour(hourIdx) {
    const tbody = $('#nordpoolBody');
    if (!tbody) return;

    // Clear all highlights first
    tbody.querySelectorAll('tr').forEach((tr) => {
      tr.classList.remove('selected-hour', 'in-range-row');
      tr.querySelectorAll('td[data-day]').forEach((td) => {
        td.classList.remove('cell-selected', 'cell-in-range');
      });
    });

    if (state.selectedNordPoolHour === 'range') {
      const rs = parseInt(state.rangeStart, 10);
      const re = parseInt(state.rangeEnd, 10);
      const isOvernight = rs > re;
      tbody.querySelectorAll('tr[data-hour]').forEach((tr) => {
        const i = parseInt(tr.dataset.hour, 10);
        // Today column
        const todayTd = tr.querySelector('td[data-day="today"]');
        const tomorrowTd = tr.querySelector('td[data-day="tomorrow"]');
        if (isOvernight) {
          if (todayTd && i >= rs) todayTd.classList.add('cell-in-range');
          if (tomorrowTd && i <= re) tomorrowTd.classList.add('cell-in-range');
          if ((i >= rs) || (i <= re)) tr.classList.add('in-range-row');
        } else {
          if (todayTd && i >= rs && i <= re) todayTd.classList.add('cell-in-range');
          if (i >= rs && i <= re) tr.classList.add('in-range-row');
        }
      });
    } else {
      const isTomorrow = String(hourIdx).startsWith('t');
      const targetHour = isTomorrow ? String(hourIdx).substring(1) : String(hourIdx);
      const targetCol = isTomorrow ? 'tomorrow' : 'today';
      tbody.querySelectorAll('tr[data-hour]').forEach((tr) => {
        if (tr.dataset.hour === targetHour) {
          tr.classList.add('selected-hour');
          const td = tr.querySelector(`td[data-day="${targetCol}"]`);
          if (td) td.classList.add('cell-selected');
        }
      });
    }
  }

  function updateRangeAvgDisplay() {
    const avgEl = $('#rangeAvgValue');
    const countEl = $('#rangeHoursCount');
    if (!avgEl) return;
    if (!nordPoolData || !nordPoolData.today || !nordPoolData.today.prices.length) {
      avgEl.textContent = '—';
      if (countEl) countEl.textContent = '';
      return;
    }
    const rs = parseInt(state.rangeStart, 10);
    const re = parseInt(state.rangeEnd, 10);
    const isOvernight = rs > re;

    let hoursInRange;
    if (isOvernight) {
      // Overnight: today's hours >= start + tomorrow's hours <= end
      const todayHours = nordPoolData.today.prices.filter((_, i) => i >= rs);
      const tomorrowHours = nordPoolData.tomorrow
        ? nordPoolData.tomorrow.prices.filter((_, i) => i <= re)
        : [];
      hoursInRange = [...todayHours, ...tomorrowHours];
    } else {
      hoursInRange = nordPoolData.today.prices.filter((_, i) => i >= rs && i <= re);
    }

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
      const overnight = isOvernight ? ' ★ overnight' : '';
      const partialWarning = isOvernight && !nordPoolData.tomorrow
        ? ' (tomorrow N/A — partial)' : '';
      countEl.textContent = `(${hoursInRange.length}h: ${fromH}–${toH}${overnight}${partialWarning})`;
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

    if (result.today && result.today.prices && result.today.prices.length > 0) {
      nordPoolData = result;
      renderNordPoolCard();
      const todayCount = result.today.prices.length;
      const tomorrowCount = result.tomorrow ? result.tomorrow.prices.length : 0;
      const sourceLabel = result.source === 'cached' ? 'Cached' : 'Live';
      if (statusEl) {
        statusEl.innerHTML = `<span class="badge badge--success">✓ ${sourceLabel} (${todayCount}h today${tomorrowCount > 0 ? ` + ${tomorrowCount}h tomorrow` : ''})</span>`;
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
