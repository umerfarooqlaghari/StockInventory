import React, { useState } from 'react';
import './Auth.css';

export default function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ email: '', password: '', companyName: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
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
        const regResult = await window.api.register(form.email, form.password, form.companyName);
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
