// web-app/src/utils/currency.js

export const SUPPORTED_CURRENCIES = [
  { code: 'SAR', symbol: 'SAR', label: 'SAR — Saudi Riyal (ر.س)' },
  { code: 'AED', symbol: 'AED', label: 'AED — UAE Dirham (د.إ)' },
  { code: 'USD', symbol: '$',   label: 'USD — US Dollar ($)' },
  { code: 'GBP', symbol: '£',   label: 'GBP — British Pound (£)' },
  { code: 'EUR', symbol: '€',   label: 'EUR — Euro (€)' },
  { code: 'QAR', symbol: 'QAR', label: 'QAR — Qatari Riyal (ر.ق)' },
  { code: 'KWD', symbol: 'KWD', label: 'KWD — Kuwaiti Dinar (د.ك)' },
  { code: 'BHD', symbol: 'BHD', label: 'BHD — Bahraini Dinar (د.ب)' },
  { code: 'OMR', symbol: 'OMR', label: 'OMR — Omani Rial (ر.ع.)' },
  { code: 'PKR', symbol: 'Rs',  label: 'PKR — Pakistani Rupee (Rs)' },
  { code: 'INR', symbol: '₹',   label: 'INR — Indian Rupee (₹)' },
  { code: 'EGP', symbol: 'E£',  label: 'EGP — Egyptian Pound (E£)' },
  { code: 'TRY', symbol: '₺',   label: 'TRY — Turkish Lira (₺)' },
  { code: 'CAD', symbol: 'CA$', label: 'CAD — Canadian Dollar (CA$)' },
  { code: 'AUD', symbol: 'A$',  label: 'AUD — Australian Dollar (A$)' },
];

let cachedConfig = null;

export async function loadTenantConfig() {
  if (window.api && window.api.getConfig) {
    const res = await window.api.getConfig();
    if (res.ok && res.data) {
      cachedConfig = res.data;
      return res.data;
    }
  }
  return cachedConfig;
}

export function getCachedConfig() {
  return cachedConfig;
}

export function getCurrencySymbol(config) {
  const cfg = config || cachedConfig;
  return cfg?.CurrencySymbol || cfg?.Currency || 'SAR';
}

export function getVatRate(config) {
  const cfg = config || cachedConfig;
  return cfg?.TaxRate !== undefined ? Number(cfg.TaxRate) : 15;
}

export function formatCurrency(amount, config) {
  const symbol = getCurrencySymbol(config);
  const num = Number(amount || 0);
  return `${symbol} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
