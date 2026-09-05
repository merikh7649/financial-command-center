/*
 * FINANCIAL COMMAND CENTER — CLEAN DEVELOPMENT MODE
 *
 * Development-only runtime layer.
 * - Keeps production localStorage untouched by redirecting only FCC keys to fcc_dev_*.
 * - Prevents the generic FCC cloud finance sync from rehydrating production data.
 * - Starts the development financial state empty.
 * - Preserves Supabase Auth and the dedicated Revolut bridge.
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

  // Keep Supabase's own auth keys untouched. Only FCC's own localStorage keys
  // are moved into a development namespace.
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
    // Never allow the development branch to clear unrelated application data.
    const keys = [];
    for (let i = 0; i < this.length; i += 1) {
      const raw = originalKey.call(this, i);
      if (raw && raw.startsWith(DEV_PREFIX)) keys.push(raw);
    }
    keys.forEach(raw => originalRemoveItem.call(this, raw));
  };

  window.FCC_CLEAN_DEV = true;

  // A prior cached deployment of revolut-live.js could still inject the legacy
  // FCC Secure Access card. The development branch has its own auth gate in
  // index.html, so remove any legacy Revolut auth card before it can remain on
  // screen. This is intentionally defensive for stale browser/Vercel caches.
  function removeLegacyRevolutAuthCard() {
    const selectors = [
      '#fcc-revolut-auth-card',
      '[data-fcc-revolut-auth-card="1"]',
      '.fcc-revolut-auth-card',
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(node => node.remove());
    });
  }

  removeLegacyRevolutAuthCard();

  const legacyAuthObserver = new MutationObserver(() => {
    removeLegacyRevolutAuthCard();
  });

  const startLegacyAuthGuard = () => {
    removeLegacyRevolutAuthCard();
    if (document.body) {
      legacyAuthObserver.observe(document.body, { childList: true, subtree: true });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startLegacyAuthGuard, { once: true });
  } else {
    startLegacyAuthGuard();
  }

  // initCloudSync is a global function in the FCC source. Replacing the global
  // function before DOMContentLoaded prevents the legacy generic finance cloud
  // sync from pulling production financial records into this development app.
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

    removeLegacyRevolutAuthCard();

    if (typeof window.renderAll === 'function') {
      window.renderAll({ resetScroll: false, scrollActiveTab: false });
    }

    // renderAll can re-create application UI after the reset; clean up one more
    // time so a stale Revolut script can never leave a second auth surface.
    setTimeout(removeLegacyRevolutAuthCard, 0);
  }

  // Run after the existing FCC DOMContentLoaded initialization. The reset is
  // one-time per page load, so data entered later in the development app stays.
  const scheduleReset = () => setTimeout(() => resetToCleanState(), 50);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleReset, { once: true });
  } else {
    scheduleReset();
  }
})();
