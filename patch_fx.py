from pathlib import Path

path = Path('revolut-live.js')
text = path.read_text()

start_marker = "    // FCC is a MXN-based command center. Never add balances from different"
end_marker = "    renderAll({ resetScroll: false, scrollActiveTab: false });"

start = text.find(start_marker)
end = text.find(end_marker, start)
if start == -1 or end == -1:
    raise SystemExit('Expected Revolut currency block was not found; refusing to modify the file.')

new_block = '''    // FCC is MXN-based, so convert every supported Revolut currency to MXN
    // before calculating Current Capital. This keeps GBP/EUR/USD sandbox
    // balances useful without ever treating their native amounts as pesos.
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
        console.warn(`[FCC FX] ECB rate unavailable for ${currency}; using blended rate.`, providerError);
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

    if (DB.settings) {
      // Current Capital is always MXN. Only override it when every Revolut
      // currency in the synced dataset has a valid FX rate to MXN.
      DB.settings.bank_balance_override_cents = hasConvertibleBalance
        ? moneyToCents(availablePrimaryBalance)
        : null;
      DB.settings.bank_data_as_of = new Date().toISOString();
      DB.settings.revolut_live = true;
      DB.settings.revolut_account_count = accountRows.length;
      DB.settings.revolut_primary_currency = 'MXN';
      DB.settings.revolut_balance_available = hasConvertibleBalance;
      DB.settings.revolut_fx_date =
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

'''

path.write_text(text[:start] + new_block + text[end:])
print('revolut-live.js patched successfully')
