/*
 * FINANCIAL COMMAND CENTER — LIVE REVOLUT BRIDGE
 *
 * Reads only non-secret Revolut account/balance data from Supabase using the
 * currently signed-in FCC Supabase session. The Revolut access/refresh tokens
 * remain server-side and are never requested by this script.
 */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://zvutyjxckqrrucsbpsqn.supabase.co';
  const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/revolut-connect`;
  const MAX_RETRIES = 40;
  const RETRY_MS = 250;

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function moneyToCents(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  function getBalanceAmount(balance) {
    const candidates = [
      balance?.amount,
      balance?.Amount?.Amount,
      balance?.balance_amount,
    ];
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  async function waitForFCC() {
    for (let i = 0; i < MAX_RETRIES; i += 1) {
      if (
        typeof supabaseClient !== 'undefined' &&
        typeof DB !== 'undefined' &&
        typeof renderAll === 'function'
      ) {
        return true;
      }
      await wait(RETRY_MS);
    }
    return false;
  }

  async function getSession() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return null;
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  async function loadLiveRevolut() {
    const session = await getSession();
    if (!session?.user) {
      console.info('[FCC Revolut] No signed-in FCC user; live banking sync skipped.');
      return null;
    }

    const client = supabaseClient;

    const [accountsResponse, balancesResponse] = await Promise.all([
      client
        .from('revolut_accounts')
        .select('account_id,currency,account_type,account_sub_type,account_data,updated_at')
        .order('updated_at', { ascending: false }),
      client
        .from('revolut_balances')
        .select('account_id,currency,amount,credit_debit_indicator,balance_type,balance_datetime,balance_data,synced_at')
        .order('synced_at', { ascending: false }),
    ]);

    if (accountsResponse.error) throw accountsResponse.error;
    if (balancesResponse.error) throw balancesResponse.error;

    const accounts = accountsResponse.data || [];
    const balances = balancesResponse.data || [];

    const latestByAccount = new Map();
    for (const balance of balances) {
      if (!balance?.account_id || latestByAccount.has(balance.account_id)) continue;
      latestByAccount.set(balance.account_id, balance);
    }

    const accountRows = accounts.map(account => ({
      ...account,
      balance: latestByAccount.get(account.account_id) || null,
    }));

    const mxnAccounts = accountRows.filter(account =>
      String(account.currency || account.balance?.currency || '').toUpperCase() === 'MXN'
    );

    const primaryAccounts = mxnAccounts.length ? mxnAccounts : accountRows;
    const totalPrimaryBalance = primaryAccounts.reduce(
      (sum, account) => sum + getBalanceAmount(account.balance),
      0,
    );

    if (DB.settings) {
      DB.settings.bank_balance_override_cents = moneyToCents(totalPrimaryBalance);
      DB.settings.bank_data_as_of = new Date().toISOString();
      DB.settings.revolut_live = true;
      DB.settings.revolut_account_count = accountRows.length;
    }

    globalThis.FCC_REVOLUT = {
      connected: true,
      syncedAt: new Date().toISOString(),
      accounts: accountRows,
      balances,
      primaryCurrency: mxnAccounts.length ? 'MXN' : null,
      primaryBalance: totalPrimaryBalance,
    };

    renderAll({ resetScroll: false, scrollActiveTab: false });

    console.info('[FCC Revolut] Live banking sync complete.', {
      accounts: accountRows.length,
      balances: balances.length,
      primaryBalance: totalPrimaryBalance,
    });

    return globalThis.FCC_REVOLUT;
  }

  async function connectAndSync() {
    try {
      const ready = await waitForFCC();
      if (!ready) {
        console.warn('[FCC Revolut] FCC app was not ready for live sync.');
        return;
      }

      await loadLiveRevolut();
    } catch (error) {
      console.error('[FCC Revolut] Live sync failed:', error);
    }
  }

  globalThis.FCCRevolut = {
    sync: connectAndSync,
    getData: () => globalThis.FCC_REVOLUT || null,
    authorizeUrl: `${EDGE_FUNCTION_URL}/authorize`,
  };

  connectAndSync();
})();
