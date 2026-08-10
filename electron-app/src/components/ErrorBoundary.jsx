import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          margin: '40px auto',
          maxWidth: 600,
          background: '#FEF2F2',
          border: '1px solid #FCA5A5',
          borderRadius: 8,
          color: '#991B1B',
          fontFamily: 'sans-serif',
          textAlign: 'center'
        }}>
          <h2 style={{ marginTop: 0, fontSize: 20 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: '#7F1D1D' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            style={{ marginTop: 16, background: '#DC2626', border: 'none', color: '#FFF', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
