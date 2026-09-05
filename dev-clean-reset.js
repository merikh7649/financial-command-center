/*
 * FINANCIAL COMMAND CENTER — CLEAN DEVELOPMENT MODE
 *
 * Development-only runtime layer.
 * - Keeps production localStorage untouched by redirecting FCC keys to fcc_dev_*.
 * - Prevents the generic FCC cloud finance sync from rehydrating production data.
 * - Starts the development financial state empty.
 * - Preserves the single native FCC auth screen and the dedicated Revolut bridge.
 * - Defensively removes any legacy Revolut auth overlay if an older cached bridge
 *   is still present in the browser or deployment.
 */
(() => {
  'use strict';

  const DEV_PREFIX = 'fcc_dev_';
  const FCC_KEY_PREFIX = 'fcc_';
  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalKey = Storage.prototype.key;
  const originalClear = Storage.prototype.clear;

  const mapKey = key => {
    const value = String(key ?? '');
    return value.startsWith(FCC_KEY_PREFIX) && !value.startsWith(DEV_PREFIX)
      ? `${DEV_PREFIX}${value.slice(FCC_KEY_PREFIX.length)}`
      : value;
  };

  Storage.prototype.getItem = function(key) {
    return originalGetItem.call(this, mapKey(key));
  };

  Storage.prototype.setItem = function(key, value) {
    return originalSetItem.call(this, mapKey(key), value);
  };

  Storage.prototype.removeItem = function(key) {
    return originalRemoveItem.call(this, mapKey(key));
  };

  Storage.prototype.key = function(index) {
    const raw = originalKey.call(this, index);
    if (raw && raw.startsWith(DEV_PREFIX)) {
      return `fcc_${raw.slice(DEV_PREFIX.length)}`;
    }
    return raw;
  };

  Storage.prototype.clear = function() {
    const keys = [];
    for (let i = 0; i < this.length; i += 1) {
      const raw = originalKey.call(this, i);
      if (raw && raw.startsWith(DEV_PREFIX)) keys.push(raw);
    }
    keys.forEach(raw => originalRemoveItem.call(this, raw));
  };

  window.FCC_CLEAN_DEV = true;

  try {
    if (typeof window.initCloudSync === 'function') {
      window.initCloudSync = async function() {
        if (typeof window.cloudSyncReady !== 'undefined') {
          window.cloudSyncReady = false;
        }
        return false;
      };
    }
  } catch (error) {
    console.warn('[FCC DEV] Could not disable generic cloud sync.', error);
  }

  function removeLegacyRevolutAuth() {
    const legacyCard = document.getElementById('fcc-revolut-auth-card');
    if (legacyCard) legacyCard.remove();

    const legacyStyles = document.getElementById('fcc-revolut-auth-styles');
    if (legacyStyles) legacyStyles.remove();
  }

  // Run immediately and keep watching for any legacy bridge that injects the
  // duplicate card after this script loads. This is intentionally defensive so
  // stale cached JS cannot recreate the second login UI on the dev preview.
  removeLegacyRevolutAuth();

  const legacyAuthObserver = new MutationObserver(() => {
    removeLegacyRevolutAuth();
  });

  legacyAuthObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForFCC() {
    for (let i = 0; i < 160; i += 1) {
      if (window.DB && window.DB.loaded === true) return true;
      await wait(250);
    }
    return false;
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

  async function resetToCleanState() {
    const ready = await waitForFCC();
    if (!ready || !window.DB) {
      console.warn('[FCC DEV] Clean state skipped: FCC did not finish loading.');
      return;
    }

    window.DB.commissions = [];
    window.DB.expenses = [];
    window.DB.otherIncome = [];
    window.DB.reimbursements = [];
    window.DB.goals = [];
    window.DB.contributions = [];
    window.DB.activity = [];
    window.DB.salesForecast = [];
    window.DB.monthlySales = {};
    window.DB.actualSales = 0;
    window.DB.actualSalesEvents = [];
    window.DB.reconciliations = [];
    window.DB.bankOtherIncome = [];
    window.DB.bankIncomeReview = [];
    window.DB.bankMonthlyBalances = [];

    if (!window.DB.settings || typeof window.DB.settings !== 'object') {
      window.DB.settings = {};
    }

    window.DB.settings.bank_balance_override_cents = null;
    window.DB.settings.bank_data_as_of = null;
    window.DB.settings.revolut_balance_available = false;
    window.DB.settings.revolut_live = false;
    window.DB.settings.revolut_account_count = 0;
    window.DB.settings.revolut_primary_currency = 'MXN';
    window.DB.settings.revolut_fx_date = null;

    persistBlankState();

    window.DB.__cleanDev = true;
    window.FCC_DEV_CLEAN = {
      enabled: true,
      resetAt: new Date().toISOString(),
    };

    removeLegacyRevolutAuth();

    if (typeof window.renderAll === 'function') {
      window.renderAll({ resetScroll: false, scrollActiveTab: false });
    }

    console.info('[FCC DEV] Clean financial state ready. Production FCC storage was not modified.');
  }

  const scheduleReset = () => setTimeout(() => resetToCleanState(), 50);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleReset, { once: true });
  } else {
    scheduleReset();
  }
})();
