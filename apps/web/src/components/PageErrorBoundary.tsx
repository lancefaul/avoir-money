import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { buttonStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { pageFallback } from './page-fallback.css.js';

interface PageErrorBoundaryProps {
  pageName: string;
  children: React.ReactNode;
}

interface PageErrorBoundaryState {
  error: Error | null;
}

export default class PageErrorBoundary extends React.Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[${this.props.pageName}] Rendering error:`, error, info.componentStack);
  }

  handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        // The outer padding matters on subnav routes — `/settings`,
        // `/healthcare`, `/investments`, `/utilities`, `/accounts` — where
        // `Layout.tsx` sets `padding: 0` because the Tabs pad their own panels.
        // An error boundary has REPLACED those tabs, so without this the card
        // sits flush against the viewport edge. Harmless elsewhere: the card is
        // centred, so the extra room reads as intended.
        <div className={pageFallback}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: vars.radius.xl,
              border: `${vars.border.thin} dashed ${vars.color.danger400}`,
              background: vars.color.danger50,
              padding: `${vars.space['16']} ${vars.space['6']}`,
              textAlign: 'center',
            }}
          >
            <div style={{ marginBottom: vars.space['3'], color: vars.color.danger400 }}>
              <AlertTriangle size={32} />
            </div>
            <p
              style={{
                fontSize: vars.font.base,
                fontWeight: vars.font.semibold,
                color: vars.color.textPrimary,
                margin: 0,
              }}
            >
              {this.props.pageName}
            </p>
            <p
              style={{
                fontSize: vars.font.sm,
                color: vars.color.textSecondary,
                margin: 0,
                marginTop: vars.space['1'],
              }}
            >
              Something went wrong
            </p>
            <div style={{ marginTop: vars.space['5'] }}>
              <button
                type="button"
                onClick={this.handleRetry}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
              >
                <RefreshCw size={15} /> Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
