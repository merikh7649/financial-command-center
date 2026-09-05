/*
 * FINANCIAL COMMAND CENTER — CLEAN DEVELOPMENT RESET
 *
 * This file exists only on the clean-revolut-dev branch.
 * It resets FCC's local financial state to a blank starting point without
 * touching Supabase Revolut connection data or the production main branch.
 * Supabase Auth remains available for the Revolut integration.
 */
(() => {
  'use strict';

  const FCC_STORAGE_KEYS = [
    'fcc_commissions',
    'fcc_expenses',
    'fcc_goals',
    'fcc_contributions',
    'fcc_activity',
    'fcc_sales_forecast',
    'fcc_actual_sales',
    'fcc_monthly_sales',
    'fcc_reconciliations',
    'fcc_actual_sales_events',
    'fcc_other_income',
  ];

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForFCC() {
    for (let i = 0; i < 120; i += 1) {
      if (window.DB && window.DB.loaded === true) return true;
      await wait(250);
    }
    return false;
  }

  async function reset() {
    const ready = await waitForFCC();
    if (!ready || !window.DB) {
      console.warn('[FCC DEV] Clean reset skipped: FCC did not finish loading.');
      return;
    }

    for (const key of FCC_STORAGE_KEYS) {
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        console.warn(`[FCC DEV] Could not clear ${key}`, error);
      }
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

    try {
      window.localStorage.setItem('fcc_commissions', '[]');
      window.localStorage.setItem('fcc_expenses', '[]');
      window.localStorage.setItem('fcc_other_income', '[]');
      window.localStorage.setItem('fcc_reconciliations', '[]');
      window.localStorage.setItem('fcc_goals', '[]');
      window.localStorage.setItem('fcc_contributions', '[]');
      window.localStorage.setItem('fcc_activity', '[]');
      window.localStorage.setItem('fcc_sales_forecast', '[]');
      window.localStorage.setItem('fcc_actual_sales', '0');
      window.localStorage.setItem('fcc_monthly_sales', '{}');
      window.localStorage.setItem('fcc_actual_sales_events', '[]');
    } catch (error) {
      console.warn('[FCC DEV] Could not persist clean local state.', error);
    }

    window.DB.__cleanDev = true;
    window.FCC_DEV_CLEAN = {
      enabled: true,
      resetAt: new Date().toISOString(),
    };

    if (typeof window.renderAll === 'function') {
      window.renderAll({ resetScroll: false, scrollActiveTab: false });
    }

    console.info('[FCC DEV] Clean financial state ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reset, { once: true });
  } else {
    reset();
  }
})();
