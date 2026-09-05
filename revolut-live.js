/*
 * FINANCIAL COMMAND CENTER — LIVE REVOLUT + SUPABASE BRIDGE
 *
 * Development branch authentication model:
 * - The existing FCC/Supabase auth screen in index.html is the single login UI.
 * - This bridge never renders a second login card.
 * - Supabase publishable key is browser-safe; Revolut access/refresh tokens stay server-side.
 * - OAuth authorization codes are exchanged server-side by the Edge Function.
 */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://zvutyjxckqrrucsbpsqn.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KMHvuXgCA-cBYz5TPK5cgw_utoIVZ4Q';
  const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/revolut-connect`;
  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  const MAX_RETRIES = 60;
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

  function loadSupabaseSDK() {
    return new Promise((resolve, reject) => {
      if (window.supabase?.createClient) {
        resolve(window.supabase);
        return;
      }

      const existing = document.querySelector('script[data-fcc-supabase-sdk="1"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.supabase), { once: true });
        existing.addEventListener('error', () => reject(new Error('Supabase SDK failed to load.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = SUPABASE_CDN;
      script.async = true;
      script.dataset.fccSupabaseSdk = '1';
      script.onload = () => {
        if (window.supabase?.createClient) resolve(window.supabase);
        else reject(new Error('Supabase SDK loaded without createClient.'));
      };
      script.onerror = () => reject(new Error('Could not load Supabase JS SDK.'));
      document.head.appendChild(script);
    });
  }

  async function ensureSupabaseClient() {
    if (window.supabaseClient) return window.supabaseClient;

    const sdk = await loadSupabaseSDK();
    window.supabaseClient = sdk.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      },
    );

    return window.supabaseClient;
  }

  function injectAuthStyles() {
    if (document.getElementById('fcc-revolut-auth-styles')) return;

    const style = document.createElement('style');
    style.id = 'fcc-revolut-auth-styles';
    style.textContent = `
      #fcc-revolut-user-card {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 99998;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 9px 11px;
        border: 1px solid rgba(184,143,76,.3);
        border-radius: 12px;
        background: rgba(17,17,17,.9);
        color: rgba(243,238,230,.8);
        font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        backdrop-filter: blur(14px);
      }
      #fcc-revolut-user-card[hidden] { display: none !important; }
      #fcc-revolut-user-card button {
        border: 0;
        background: transparent;
        color: #b88f4c;
        cursor: pointer;
        font: inherit;
      }
      #fcc-revolut-toast {
        position: fixed;
        left: 50%;
        bottom: 22px;
        transform: translateX(-50%);
        z-index: 100000;
        max-width: calc(100vw - 36px);
        padding: 11px 14px;
        border: 1px solid rgba(184,143,76,.35);
        border-radius: 12px;
        background: rgba(17,17,17,.96);
        color: #f3eee6;
        font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 12px 40px rgba(0,0,0,.4);
        opacity: 0;
        pointer-events: none;
        transition: opacity .2s ease;
      }
      #fcc-revolut-toast.show { opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  function showToast(message) {
    injectAuthStyles();
    let toast = document.getElementById('fcc-revolut-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'fcc-revolut-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function ensureAuthUI() {
    injectAuthStyles();

    let userCard = document.getElementById('fcc-revolut-user-card');
    if (userCard) return userCard;

    userCard = document.createElement('div');
    userCard.id = 'fcc-revolut-user-card';
    userCard.hidden = true;
    userCard.innerHTML = `
      <span id="fcc-revolut-user-label"></span>
      <button id="fcc-revolut-connect" type="button">Connect Revolut</button>
      <button id="fcc-revolut-signout" type="button">Sign out</button>
    `;
    document.body.appendChild(userCard);

    document.getElementById('fcc-revolut-connect').addEventListener('click', () => {
      window.location.href = `${EDGE_FUNCTION_URL}/authorize`;
    });

    document.getElementById('fcc-revolut-signout').addEventListener('click', async () => {
      try {
        const client = await ensureSupabaseClient();
        const { error } = await client.auth.signOut();
        if (error) throw error;
        window.FCC_REVOLUT = null;
        if (window.DB?.settings) {
          window.DB.settings.revolut_live = false;
        }
        await refreshAuthUI();
        if (typeof window.renderAll === 'function') {
          window.renderAll({ resetScroll: false, scrollActiveTab: false });
        }
        showToast('Signed out.');
      } catch (error) {
        console.error('[FCC Auth] Sign-out failed:', error);
        showToast(error?.message || 'Sign-out failed.');
      }
    });

    return userCard;
  }

  async function getSession() {
    const client = await ensureSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  async function refreshAuthUI() {
    const userCard = ensureAuthUI();
    const label = document.getElementById('fcc-revolut-user-label');
    const session = await getSession();

    if (session?.user) {
      userCard.hidden = false;
      if (label) label.textContent = session.user.email || 'Signed in';
    } else {
      userCard.hidden = true;
    }

    return session;
  }

  async function waitForFCC() {
    for (let i = 0; i < MAX_RETRIES; i += 1) {
      if (
        typeof DB !== 'undefined' &&
        typeof renderAll === 'function'
      ) {
        return true;
      }
      await wait(RETRY_MS);
    }
    return false;
  }

  function cleanOAuthUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      url.searchParams.delete('id_token');
      url.hash = '';
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
    } catch (error) {
      console.warn('[FCC Revolut] Could not clean OAuth URL:', error);
    }
  }

  async function exchangeOAuthCodeIfPresent() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (!code) return false;

    try {
      showToast('Completing Revolut connection…');
      const response = await fetch(`${EDGE_FUNCTION_URL}/exchange-and-persist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `Revolut connection failed (${response.status}).`);
      }

      cleanOAuthUrl();
      showToast(`Revolut connected: ${result.persisted?.accounts ?? 0} accounts synced.`);
      return true;
    } catch (error) {
      console.error('[FCC Revolut] OAuth exchange failed:', error);
      cleanOAuthUrl();
      showToast(error?.message || 'Revolut connection failed.');
      return false;
    }
  }

  async function loadLiveRevolut() {
    const session = await getSession();
    if (!session?.user) {
      console.info('[FCC Revolut] No signed-in FCC user; live banking sync skipped.');
      return null;
    }

    const client = window.supabaseClient;

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

    // FCC is MXN-based. Convert each synced Revolut currency to MXN before
    // calculating Current Capital, but never treat native GBP/EUR/USD values
    // as MXN amounts.
    const currencyBalances = new Map();
    for (const account of accountRows) {
      const currency = String(
        account.currency || account.balance?.currency || ''
      ).toUpperCase();
      if (!currency) continue;
      currencyBalances.set(
        currency,
        (currencyBalances.get(currency) || 0) + getBalanceAmount(account.balance),
      );
    }

    async function fetchFxRateToMxn(currency) {
      if (currency === 'MXN') return { rate: 1, date: null, provider: 'MXN' };

      const providerUrl =
        `https://api.frankfurter.dev/v2/rates?base=${encodeURIComponent(currency)}&quotes=MXN&providers=ECB`;
      const fallbackUrl =
        `https://api.frankfurter.dev/v2/rates?base=${encodeURIComponent(currency)}&quotes=MXN`;

      const request = async url => {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`FX request failed (${response.status})`);
        const rows = await response.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        const rate = Number(row?.rate);
        if (!Number.isFinite(rate) || rate <= 0) {
          throw new Error(`No MXN rate returned for ${currency}`);
        }
        return { rate, date: row?.date || null, provider: 'ECB' };
      };

      try {
        return await request(providerUrl);
      } catch (providerError) {
        console.warn(`[FCC FX] ECB rate unavailable for ${currency}; using Frankfurter fallback.`, providerError);
        const result = await request(fallbackUrl);
        return { ...result, provider: 'Frankfurter blended' };
      }
    }

    const currencies = [...currencyBalances.keys()];
    const fxResults = await Promise.all(
      currencies.map(async currency => {
        try {
          return [currency, await fetchFxRateToMxn(currency)];
        } catch (error) {
          console.error(`[FCC FX] Could not convert ${currency} to MXN.`, error);
          return [currency, null];
        }
      }),
    );

    const fxRates = Object.fromEntries(fxResults);
    const convertedCurrencyBalances = {};
    let convertedMxnTotal = 0;
    let fxComplete = true;

    for (const [currency, nativeAmount] of currencyBalances.entries()) {
      const fx = fxRates[currency];
      if (!fx?.rate) {
        fxComplete = false;
        continue;
      }

      const converted = nativeAmount * fx.rate;
      convertedCurrencyBalances[currency] = converted;
      convertedMxnTotal += converted;
    }

    const availablePrimaryBalance = fxComplete ? convertedMxnTotal : null;
    const hasConvertibleBalance =
      fxComplete && Number.isFinite(availablePrimaryBalance);

    if (window.DB?.settings) {
      window.DB.settings.bank_balance_override_cents = hasConvertibleBalance
        ? moneyToCents(availablePrimaryBalance)
        : null;
      window.DB.settings.bank_data_as_of = new Date().toISOString();
      window.DB.settings.revolut_live = true;
      window.DB.settings.revolut_account_count = accountRows.length;
      window.DB.settings.revolut_primary_currency = 'MXN';
      window.DB.settings.revolut_balance_available = hasConvertibleBalance;
      window.DB.settings.revolut_fx_date =
        currencies.map(currency => fxRates[currency]?.date).filter(Boolean).sort().pop() || null;
    }

    globalThis.FCC_REVOLUT = {
      connected: true,
      syncedAt: new Date().toISOString(),
      accounts: accountRows,
      balances,
      primaryCurrency: 'MXN',
      primaryBalance: hasConvertibleBalance ? availablePrimaryBalance : null,
      nativeCurrencyBalances: Object.fromEntries(currencyBalances),
      convertedCurrencyBalances,
      currencyBalances: convertedCurrencyBalances,
      fxRates,
      fxComplete,
      balanceAvailable: hasConvertibleBalance,
    };

    if (typeof window.renderAll === 'function') {
      window.renderAll({ resetScroll: false, scrollActiveTab: false });
    }

    console.info('[FCC Revolut] Live banking sync complete.', {
      accounts: accountRows.length,
      balances: balances.length,
      currencies: Object.fromEntries(currencyBalances),
      mxnBalance: availablePrimaryBalance,
    });

    return globalThis.FCC_REVOLUT;
  }

  function reapplyRevolutCapital() {
    const data = globalThis.FCC_REVOLUT;
    if (!data?.balanceAvailable || !Number.isFinite(Number(data.primaryBalance))) return;
    if (!globalThis.DB?.settings || typeof globalThis.renderAll !== 'function') return;

    globalThis.DB.settings.bank_balance_override_cents = moneyToCents(data.primaryBalance);
    globalThis.DB.settings.bank_data_as_of = data.syncedAt || new Date().toISOString();
    globalThis.DB.settings.revolut_live = true;
    globalThis.DB.settings.revolut_primary_currency = 'MXN';
    globalThis.DB.settings.revolut_balance_available = true;
    globalThis.renderAll({ resetScroll: false, scrollActiveTab: false });
  }

  async function connectAndSync() {
    try {
      const client = await ensureSupabaseClient();
      ensureAuthUI();

      // Keep the single existing FCC auth screen as the login UI, but watch
      // this client for sign-in/sign-out so the Revolut bridge reacts to it.
      if (!window.__FCC_REVOLUT_AUTH_LISTENER__) {
        window.__FCC_REVOLUT_AUTH_LISTENER__ = true;
        client.auth.onAuthStateChange((event, session) => {
          void refreshAuthUI();
          if (event === 'SIGNED_IN' && session?.user) {
            void (async () => {
              try {
                const ready = await waitForFCC();
                if (!ready) return;
                await loadLiveRevolut();
                [250, 1000, 2500, 5000].forEach(delay => {
                  setTimeout(reapplyRevolutCapital, delay);
                });
              } catch (error) {
                console.error('[FCC Revolut] Post-login sync failed:', error);
                showToast(error?.message || 'Live Revolut sync failed.');
              }
            })();
          }
        });
      }

      await refreshAuthUI();

      const ready = await waitForFCC();
      if (!ready) {
        console.warn('[FCC Revolut] FCC app was not ready for live sync.');
        return;
      }

      await exchangeOAuthCodeIfPresent();

      const session = await getSession();
      if (session?.user) {
        await loadLiveRevolut();
        [250, 1000, 2500, 5000].forEach(delay => {
          setTimeout(reapplyRevolutCapital, delay);
        });
      }
    } catch (error) {
      console.error('[FCC Revolut] Live sync failed:', error);
      showToast(error?.message || 'Live Revolut sync failed.');
    }
  }

  window.FCCRevolut = {
    sync: connectAndSync,
    getData: () => window.FCC_REVOLUT || null,
    getSession,
    authorizeUrl: `${EDGE_FUNCTION_URL}/authorize`,
    signOut: async () => {
      const client = await ensureSupabaseClient();
      return client.auth.signOut();
    },
  };

  window.addEventListener('load', () => {
    connectAndSync();
  });
})();
