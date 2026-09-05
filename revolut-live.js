/*
 * FINANCIAL COMMAND CENTER — LIVE REVOLUT + SUPABASE BRIDGE
 *
 * Browser-safe layer:
 * - Supabase publishable key only.
 * - Supabase Auth session stays in the browser-managed Supabase session.
 * - Revolut access/refresh tokens never enter this file or the browser.
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

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
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
      #fcc-revolut-auth-card {
        position: fixed;
        inset: auto 18px 18px 18px;
        z-index: 99999;
        max-width: 430px;
        margin: 0 auto;
        padding: 20px;
        border: 1px solid rgba(184, 143, 76, .35);
        border-radius: 18px;
        background: rgba(17, 17, 17, .97);
        box-shadow: 0 18px 60px rgba(0,0,0,.45);
        color: #f3eee6;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        backdrop-filter: blur(18px);
      }
      #fcc-revolut-auth-card[hidden] { display: none !important; }
      #fcc-revolut-auth-card .fcc-auth-title {
        margin: 0 0 6px;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 22px;
        letter-spacing: .01em;
      }
      #fcc-revolut-auth-card .fcc-auth-subtitle {
        margin: 0 0 16px;
        color: rgba(243,238,230,.68);
        font-size: 13px;
        line-height: 1.45;
      }
      #fcc-revolut-auth-card input {
        box-sizing: border-box;
        width: 100%;
        margin: 0 0 10px;
        padding: 12px 13px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 10px;
        background: rgba(255,255,255,.055);
        color: #fff;
        outline: none;
      }
      #fcc-revolut-auth-card input:focus {
        border-color: rgba(184,143,76,.7);
      }
      #fcc-revolut-auth-card .fcc-auth-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px;
        margin-top: 4px;
      }
      #fcc-revolut-auth-card button {
        appearance: none;
        border: 0;
        border-radius: 10px;
        padding: 11px 12px;
        cursor: pointer;
        font-weight: 600;
      }
      #fcc-revolut-auth-card .fcc-primary {
        background: #b88f4c;
        color: #111;
      }
      #fcc-revolut-auth-card .fcc-secondary {
        background: rgba(255,255,255,.08);
        color: #f3eee6;
      }
      #fcc-revolut-auth-card .fcc-status {
        min-height: 18px;
        margin-top: 11px;
        color: rgba(243,238,230,.68);
        font-size: 12px;
        line-height: 1.4;
      }
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

    let card = document.getElementById('fcc-revolut-auth-card');
    if (!card) {
      card = document.createElement('section');
      card.id = 'fcc-revolut-auth-card';
      card.hidden = true;
      card.innerHTML = `
        <h2 class="fcc-auth-title">FCC Secure Access</h2>
        <p class="fcc-auth-subtitle">
          Sign in to load your private Revolut account data into Financial Command Center.
        </p>
        <input id="fcc-auth-email" type="email" autocomplete="email" placeholder="Email" />
        <input id="fcc-auth-password" type="password" autocomplete="current-password" placeholder="Password" />
        <div class="fcc-auth-actions">
          <button id="fcc-auth-signin" class="fcc-primary" type="button">Sign in</button>
          <button id="fcc-auth-signup" class="fcc-secondary" type="button">Create account</button>
        </div>
        <div id="fcc-auth-status" class="fcc-status"></div>
      `;
      document.body.appendChild(card);

      const emailInput = document.getElementById('fcc-auth-email');
      const passwordInput = document.getElementById('fcc-auth-password');
      const status = document.getElementById('fcc-auth-status');

      const runAuth = async mode => {
        try {
          status.textContent = mode === 'signin' ? 'Signing in…' : 'Creating account…';
          const client = await ensureSupabaseClient();
          const email = emailInput.value.trim();
          const password = passwordInput.value;

          if (!email || !password) {
            status.textContent = 'Enter your email and password.';
            return;
          }
          if (password.length < 6) {
            status.textContent = 'Password must be at least 6 characters.';
            return;
          }

          if (mode === 'signin') {
            const { error } = await client.auth.signInWithPassword({ email, password });
            if (error) throw error;
            status.textContent = 'Signed in. Loading Revolut data…';
            await refreshAuthUI();
            await loadLiveRevolut();
          } else {
            const { data, error } = await client.auth.signUp({ email, password });
            if (error) throw error;
            if (!data?.session) {
              status.textContent = 'Account created. Check your email to confirm the account, then sign in.';
            } else {
              status.textContent = 'Account created. Loading Revolut data…';
              await refreshAuthUI();
              await loadLiveRevolut();
            }
          }
        } catch (error) {
          console.error('[FCC Auth] Authentication failed:', error);
          status.textContent = error?.message || 'Authentication failed.';
        }
      };

      document.getElementById('fcc-auth-signin').addEventListener('click', () => runAuth('signin'));
      document.getElementById('fcc-auth-signup').addEventListener('click', () => runAuth('signup'));
    }

    let userCard = document.getElementById('fcc-revolut-user-card');
    if (!userCard) {
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
          showToast('Signed out.');
        } catch (error) {
          console.error('[FCC Auth] Sign-out failed:', error);
          showToast(error?.message || 'Sign-out failed.');
        }
      });
    }
  }

  async function getSession() {
    const client = await ensureSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  async function refreshAuthUI() {
    ensureAuthUI();
    const session = await getSession();
    const card = document.getElementById('fcc-revolut-auth-card');
    const userCard = document.getElementById('fcc-revolut-user-card');
    const label = document.getElementById('fcc-revolut-user-label');

    if (session?.user) {
      card.hidden = true;
      userCard.hidden = false;
      label.textContent = session.user.email || 'Signed in';
    } else {
      card.hidden = false;
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

    // FCC is a MXN-based command center. Never add balances from different
    // currencies together as though they were MXN. Sandbox test accounts may
    // be GBP/EUR/etc., while a future production connection can contain MXN.
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

    const mxnBalance = currencyBalances.get('MXN');
    const hasMxn = Number.isFinite(mxnBalance);
    const availablePrimaryBalance = hasMxn ? mxnBalance : null;

    if (DB.settings) {
      // Only let Revolut override Current Capital when an MXN balance exists.
      // This prevents a GBP/EUR Sandbox account from being displayed as pesos.
      if (hasMxn) {
        DB.settings.bank_balance_override_cents = moneyToCents(availablePrimaryBalance);
      } else {
        DB.settings.bank_balance_override_cents = null;
      }
      DB.settings.bank_data_as_of = new Date().toISOString();
      DB.settings.revolut_live = true;
      DB.settings.revolut_account_count = accountRows.length;
      DB.settings.revolut_primary_currency = hasMxn ? 'MXN' : null;
      DB.settings.revolut_balance_available = hasMxn;
    }

    globalThis.FCC_REVOLUT = {
      connected: true,
      syncedAt: new Date().toISOString(),
      accounts: accountRows,
      balances,
      primaryCurrency: hasMxn ? 'MXN' : null,
      primaryBalance: availablePrimaryBalance,
      currencyBalances: Object.fromEntries(currencyBalances),
      balanceAvailable: hasMxn,
    };

    renderAll({ resetScroll: false, scrollActiveTab: false });

    console.info('[FCC Revolut] Live banking sync complete.', {
      accounts: accountRows.length,
      balances: balances.length,
      currencies: Object.fromEntries(currencyBalances),
      mxnBalance: availablePrimaryBalance,
    });

    return globalThis.FCC_REVOLUT;
  }

  async function connectAndSync() {
    try {
      await ensureSupabaseClient();
      ensureAuthUI();
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
