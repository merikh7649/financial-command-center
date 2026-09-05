/*
 * FINANCIAL COMMAND CENTER — CLEAN DEVELOPMENT MODE
 *
 * Development-only runtime layer.
 * - Keeps production localStorage untouched by using this preview's own origin.
 * - Prevents the generic FCC cloud finance sync from rehydrating production data.
 * - Starts the development financial state empty.
 * - Removes legacy Revolut auth UI.
 * - Disables demo financial trajectory data in development.
 * - Blanks demo forecast output until real financial data exists.
 * - Preserves the single native FCC auth screen and the dedicated Revolut bridge.
 * - Releases the native auth gate after successful sign-in.
 * - Makes the monthly sales objective editable and persistent.
 */
(() => {
  'use strict';

  window.FCC_CLEAN_DEV = true;

  function getFCCDB() {
    try {
      if (typeof DB !== 'undefined' && DB && typeof DB === 'object') {
        return DB;
      }
    } catch (error) {
      // Ignore and fall through to null.
    }
    return null;
  }

  function getMonthlySalesTarget() {
    const db = getFCCDB();
    const value = Number(db?.settings?.monthly_sales_target);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 20;
  }

  function persistMonthlySalesTarget(value) {
    const db = getFCCDB();
    if (!db) return;

    const target = Math.max(1, Math.floor(Number(value) || 20));
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    db.settings.monthly_sales_target = target;

    try {
      window.localStorage.setItem('fcc_dev_settings', JSON.stringify(db.settings));
    } catch (error) {
      console.warn('[FCC DEV] Could not persist monthly sales target.', error);
    }
  }

  function removeLegacyRevolutAuth() {
    const legacyCard = document.getElementById('fcc-revolut-auth-card');
    if (legacyCard) legacyCard.remove();

    const legacyStyles = document.getElementById('fcc-revolut-auth-styles');
    if (legacyStyles) legacyStyles.remove();
  }

  function releaseSignedInGate() {
    const gate = document.getElementById('fcc-auth-gate');
    if (!gate) return;

    const text = (gate.textContent || '').toLowerCase();
    if (text.includes('signed in')) {
      gate.style.display = 'none';
      gate.setAttribute('aria-hidden', 'true');
    }
  }

  function hasRealForecastData(db) {
    const commissions = Array.isArray(db?.commissions) ? db.commissions : [];
    const salesEvents = Array.isArray(db?.actualSalesEvents) ? db.actualSalesEvents : [];
    const salesForecast = Array.isArray(db?.salesForecast) ? db.salesForecast : [];
    const otherIncome = Array.isArray(db?.otherIncome) ? db.otherIncome : [];
    const actualSales = Number(db?.actualSales || 0);

    return actualSales > 0 || commissions.length > 0 || salesEvents.length > 0 || salesForecast.length > 0 || otherIncome.length > 0;
  }

  function blankDemoForecastIfEmpty() {
    const db = getFCCDB();
    if (!db || hasRealForecastData(db)) return;

    const screen = document.querySelector('.forecast-visual-screen');
    if (!screen) return;

    const main = screen.querySelector('.forecast-main-card');
    if (main && !main.dataset.fccCleanBlank) {
      main.innerHTML = `
        <div class="forecast-card-kicker">FORECAST</div>
        <div class="empty" style="padding:44px 12px 36px;">
          <div class="headline">No financial data yet.</div>
          <div class="caption">Your forecast will appear once you add real financial activity.</div>
        </div>`;
      main.dataset.fccCleanBlank = 'true';
    }

    screen.querySelectorAll('.forecast-summary-card, .forecast-monthly-card, .forecast-scenarios-card').forEach(card => card.remove());
  }

  function makeTargetDynamic(functionName) {
    try {
      const fn = window[functionName];
      if (typeof fn !== 'function') return;

      const source = Function.prototype.toString.call(fn);
      if (!source.includes('MONTHLY_SALES_TARGET')) return;

      const patched = source.replace(/\bMONTHLY_SALES_TARGET\b/g, 'getMonthlySalesTarget()');
      const rebuilt = eval(`(${patched})`);
      window[functionName] = rebuilt;
    } catch (error) {
      console.warn(`[FCC DEV] Could not make ${functionName} target-aware.`, error);
    }
  }

  function installDynamicMonthlyTarget() {
    // This helper becomes the single source of truth for the editable objective.
    window.getMonthlySalesTarget = getMonthlySalesTarget;
    window.calculateMonthlyFinancialTargetCents = function() {
      return getMonthlySalesTarget() * actualNetCommissionPerSaleCents();
    };

    [
      'derive',
      'screenCommand',
      'screenPlanWeekly',
      'screenPlanSales',
      'screenPlanActivity',
      'systemIntegrityReport'
    ].forEach(makeTargetDynamic);
  }

  function patchSettingsTargetInput() {
    const db = getFCCDB();
    if (!db) return;

    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    const savedTarget = Number(db.settings.monthly_sales_target);
    if (!Number.isFinite(savedTarget) || savedTarget <= 0) {
      db.settings.monthly_sales_target = 20;
    }

    const labels = Array.from(document.querySelectorAll('.tiny'));
    const label = labels.find(el => (el.textContent || '').trim().toLowerCase() === 'monthly sales target');
    if (!label) return;

    const wrapper = label.parentElement;
    const input = wrapper?.querySelector('input');
    if (!input) return;

    input.id = 'setMonthlySalesTarget';
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.step = '1';
    input.readOnly = false;
    input.removeAttribute('readonly');
    input.disabled = false;
    input.value = String(getMonthlySalesTarget());
    input.setAttribute('aria-label', 'Monthly sales target');
  }

  function installSettingsSaveHook() {
    try {
      if (window.__FCC_MONTHLY_TARGET_SAVE_HOOK__) return;
      if (typeof window.handleAction !== 'function') return;

      const originalHandleAction = window.handleAction;
      window.handleAction = async function(action, ds, evt) {
        if (action === 'save-settings') {
          const input = document.getElementById('setMonthlySalesTarget');
          const raw = input ? Number(input.value) : getMonthlySalesTarget();
          const target = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
          persistMonthlySalesTarget(target);
          installDynamicMonthlyTarget();
        }
        return originalHandleAction.call(this, action, ds, evt);
      };

      window.__FCC_MONTHLY_TARGET_SAVE_HOOK__ = true;
    } catch (error) {
      console.warn('[FCC DEV] Could not install monthly target save hook.', error);
    }
  }

  function watchAuthGate() {
    releaseSignedInGate();

    const observer = new MutationObserver(() => {
      releaseSignedInGate();
      removeLegacyRevolutAuth();
      patchSettingsTargetInput();
      blankDemoForecastIfEmpty();
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    window.setInterval(() => {
      releaseSignedInGate();
      removeLegacyRevolutAuth();
      patchSettingsTargetInput();
      blankDemoForecastIfEmpty();
    }, 400);
  }

  function waitForFCC() {
    return new Promise(resolve => {
      const started = Date.now();
      const timeout = 40000;

      const check = () => {
        const db = getFCCDB();
        if (db) {
          resolve(db);
          return;
        }

        if (Date.now() - started >= timeout) {
          resolve(null);
          return;
        }

        window.setTimeout(check, 250);
      };

      check();
    });
  }

  function persistBlankState() {
    const blank = {
      'fcc_commissions': '[]',
      'fcc_expenses': '[]',
      'fcc_goals': '[]',
      'fcc_contributions': '[]',
      'fcc_activity': '[]',
      'fcc_sales_forecast': '[]',
      'fcc_actual_sales': '0',
      'fcc_monthly_sales': '{}',
      'fcc_reconciliations': '[]',
      'fcc_actual_sales_events': '[]',
      'fcc_other_income': '[]',
    };

    for (const [key, value] of Object.entries(blank)) {
      try {
        window.localStorage.setItem(key, value);
      } catch (error) {
        console.warn(`[FCC DEV] Could not persist ${key}.`, error);
      }
    }
  }

  function disableDemoTrajectory() {
    try {
      if (typeof REAL_BANK_IMPORT !== 'undefined' && REAL_BANK_IMPORT && typeof REAL_BANK_IMPORT === 'object') {
        REAL_BANK_IMPORT.trajectory_daily_balances = {};
        REAL_BANK_IMPORT.current_balance_cents = 0;
      }
    } catch (error) {
      console.warn('[FCC DEV] Could not clear demo trajectory source.', error);
    }

    try {
      if (typeof window.rollingTrajectoryPoints === 'function') {
        window.rollingTrajectoryPoints = function() {
          return {
            points: [],
            labels: [],
            todayIndex: 0,
            currentValue: 0,
          };
        };
      }
    } catch (error) {
      console.warn('[FCC DEV] Could not disable demo trajectory renderer.', error);
    }
  }

  async function resetToCleanState() {
    const db = await waitForFCC();
    if (!db) {
      console.warn('[FCC DEV] Clean state skipped: FCC DB object did not become available.');
      return;
    }

    db.commissions = [];
    db.expenses = [];
    db.otherIncome = [];
    db.reimbursements = [];
    db.goals = [];
    db.contributions = [];
    db.activity = [];
    db.salesForecast = [];
    db.monthlySales = {};
    db.actualSales = 0;
    db.actualSalesEvents = [];
    db.reconciliations = [];
    db.bankOtherIncome = [];
    db.bankIncomeReview = [];
    db.bankMonthlyBalances = [];

    if (!db.settings || typeof db.settings !== 'object') {
      db.settings = {};
    }

    db.settings.bank_balance_override_cents = null;
    db.settings.bank_data_as_of = null;
    db.settings.revolut_balance_available = false;
    db.settings.revolut_live = false;
    db.settings.revolut_account_count = 0;
    db.settings.revolut_primary_currency = 'MXN';
    db.settings.revolut_fx_date = null;
    if (!Number.isFinite(Number(db.settings.monthly_sales_target)) || Number(db.settings.monthly_sales_target) <= 0) {
      db.settings.monthly_sales_target = 20;
    }

    disableDemoTrajectory();
    persistBlankState();

    db.__cleanDev = true;
    window.FCC_DEV_CLEAN = {
      enabled: true,
      resetAt: new Date().toISOString(),
    };

    installSettingsSaveHook();
    installDynamicMonthlyTarget();

    if (typeof window.renderAll === 'function') {
      window.renderAll({ resetScroll: false, scrollActiveTab: false });
    }

    removeLegacyRevolutAuth();
    releaseSignedInGate();
    patchSettingsTargetInput();
    blankDemoForecastIfEmpty();

    console.info('[FCC DEV] Clean financial state ready. Monthly sales target:', getMonthlySalesTarget());
  }

  removeLegacyRevolutAuth();
  installSettingsSaveHook();
  installDynamicMonthlyTarget();
  watchAuthGate();
  disableDemoTrajectory();

  const scheduleReset = () => setTimeout(() => resetToCleanState(), 100);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleReset, { once: true });
  } else {
    scheduleReset();
  }
})();