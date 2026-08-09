import React, { useState } from 'react';
import './Auth.css';
import { SUPPORTED_CURRENCIES } from '../utils/currency.js';

const REGION_PRESETS = {
  KSA: { label: 'Saudi Arabia (KSA)', defaultCurrency: 'SAR', vat: 15 },
  UAE: { label: 'United Arab Emirates (UAE)', defaultCurrency: 'AED', vat: 5 },
  QAT: { label: 'Qatar', defaultCurrency: 'QAR', vat: 0 },
  KWT: { label: 'Kuwait', defaultCurrency: 'KWD', vat: 0 },
  BHR: { label: 'Bahrain', defaultCurrency: 'BHD', vat: 10 },
  OMN: { label: 'Oman', defaultCurrency: 'OMR', vat: 5 },
  UK:  { label: 'United Kingdom (UK)', defaultCurrency: 'GBP', vat: 20 },
  USA: { label: 'United States (USA)', defaultCurrency: 'USD', vat: 0 },
  OTHER: { label: 'Other Region', defaultCurrency: 'USD', vat: 0 },
};

export default function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({
    email: '',
    password: '',
    companyName: '',
    region: 'KSA',
    currency: 'SAR',
    currencySymbol: 'SAR',
    vatRate: 15,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleRegionChange(e) {
    const reg = e.target.value;
    const preset = REGION_PRESETS[reg] || REGION_PRESETS.OTHER;
    const currMatch = SUPPORTED_CURRENCIES.find(c => c.code === preset.defaultCurrency) || SUPPORTED_CURRENCIES[0];
    setForm(f => ({
      ...f,
      region: reg,
      currency: currMatch.code,
      currencySymbol: currMatch.symbol,
      vatRate: preset.vat,
    }));
    setError('');
  }

  function handleCurrencyChange(e) {
    const code = e.target.value;
    const currMatch = SUPPORTED_CURRENCIES.find(c => c.code === code) || SUPPORTED_CURRENCIES[0];
    setForm(f => ({
      ...f,
      currency: currMatch.code,
      currencySymbol: currMatch.symbol,
    }));
    setError('');
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      let result;
      if (mode === 'login') {
        result = await window.api.login(form.email, form.password);
        if (!result.ok) throw new Error(result.error || 'Sign in failed');
      } else {
        const regResult = await window.api.register(
          form.email,
          form.password,
          form.companyName,
          form.region,
          form.currency,
          form.currencySymbol,
          form.vatRate
        );
        if (!regResult.ok) throw new Error(regResult.error || 'Registration failed');
        result = await window.api.login(form.email, form.password);
        if (!result.ok) throw new Error(result.error || 'Sign in after registration failed');
      }

      onAuthenticated({ token: result.data?.token, companyName: result.data?.companyName });
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-root">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">📦</div>
          <h1 className="auth-brand">Stock Inventory</h1>
          <p className="auth-tagline">Printing plates inventory, sales &amp; purchases</p>
        </div>

        <div className="auth-tabs">
          <button
            id="tab-login"
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >Sign In</button>
          <button
            id="tab-register"
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >Create Account</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <>
              <div className="auth-field">
                <label htmlFor="auth-company">Company Name</label>
                <input
                  id="auth-company"
                  name="companyName"
                  type="text"
                  placeholder="Alpha Printing Co."
                  value={form.companyName}
                  onChange={handleChange}
                  required
                  autoFocus
                />
              </div>

              <div className="auth-field">
                <label htmlFor="auth-region">Country / Region</label>
                <select
                  id="auth-region"
                  name="region"
                  value={form.region}
                  onChange={handleRegionChange}
                  className="auth-select"
                >
                  {Object.entries(REGION_PRESETS).map(([key, val]) => (
                    <option key={key} value={key}>{val.label}</option>
                  ))}
                </select>
              </div>

              <div className="auth-field">
                <label htmlFor="auth-currency">Currency</label>
                <select
                  id="auth-currency"
                  name="currency"
                  value={form.currency}
                  onChange={handleCurrencyChange}
                  className="auth-select"
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              placeholder="you@company.com"
              value={form.email}
              onChange={handleChange}
              required
              autoFocus={mode === 'login'}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              name="password"
              type="password"
              placeholder={mode === 'register' ? 'Min. 8 characters' : '••••••••'}
              value={form.password}
              onChange={handleChange}
              required
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button id="auth-submit" className="auth-submit" type="submit" disabled={loading}>
            {loading
              ? (mode === 'login' ? 'Signing in…' : 'Creating account…')
              : (mode === 'login' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <p className="auth-footer">
          {mode === 'login'
            ? 'New to this system? '
            : 'Already have an account? '}
          <button
            id="auth-switch"
            className="auth-switch-link"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
          >
            {mode === 'login' ? 'Create account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
