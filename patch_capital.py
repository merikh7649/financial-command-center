from pathlib import Path

path = Path('revolut-live.js')
text = path.read_text()

needle = "  async function connectAndSync() {"
if needle not in text:
    raise SystemExit('connectAndSync marker not found')

helper = '''  function reapplyRevolutCapital() {\n    const data = globalThis.FCC_REVOLUT;\n    if (!data?.balanceAvailable || !Number.isFinite(Number(data.primaryBalance))) return;\n    if (!globalThis.DB?.settings || typeof globalThis.renderAll !== 'function') return;\n\n    globalThis.DB.settings.bank_balance_override_cents = moneyToCents(data.primaryBalance);\n    globalThis.DB.settings.bank_data_as_of = data.syncedAt || new Date().toISOString();\n    globalThis.DB.settings.revolut_live = true;\n    globalThis.DB.settings.revolut_primary_currency = 'MXN';\n    globalThis.DB.settings.revolut_balance_available = true;\n    globalThis.renderAll({ resetScroll: false, scrollActiveTab: false });\n  }\n\n'''
if 'function reapplyRevolutCapital()' not in text:
    text = text.replace(needle, helper + needle, 1)

old = '''      if (session?.user) {\n        await loadLiveRevolut();\n      }'''
new = '''      if (session?.user) {\n        await loadLiveRevolut();\n\n        // The FCC bootstrap also restores its local bank snapshot. Re-apply\n        // the live Revolut MXN value after that bootstrap finishes so the\n        // converted Revolut balance remains the source of Current Capital.\n        [250, 1000, 2500, 5000].forEach(delay => {\n          setTimeout(reapplyRevolutCapital, delay);\n        });\n      }'''
if old not in text:
    raise SystemExit('session sync block not found')
text = text.replace(old, new, 1)

path.write_text(text)
print('revolut-live.js patched successfully')
