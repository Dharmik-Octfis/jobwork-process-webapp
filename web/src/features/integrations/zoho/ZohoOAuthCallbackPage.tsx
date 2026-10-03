import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export function ZohoOAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const [countdown, setCountdown] = useState(5);

  const status = searchParams.get('status');
  const orgId = searchParams.get('orgId');
  const errorParam = searchParams.get('error');

  const isSuccess = status === 'authorized' && !errorParam;
  const errorMessage = errorParam ? decodeURIComponent(errorParam) : 'Unable to complete Zoho authorization.';

  // Notify opener window via postMessage on mount
  useEffect(() => {
    try {
      if (window.opener && window.opener !== window) {
        window.opener.postMessage(
          {
            type: 'ZOHO_OAUTH_CALLBACK',
            status: isSuccess ? 'authorized' : 'error',
            orgId: orgId || undefined,
            error: errorParam ? decodeURIComponent(errorParam) : undefined,
          },
          window.location.origin,
        );
      }
    } catch (err) {
      console.error('Failed to postMessage to opener:', err);
    }
  }, [isSuccess, orgId, errorParam]);

  // 5-second auto-close timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          try {
            window.close();
          } catch {
            // Browser may block automatic window.close if opened without script
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleManualClose = () => {
    try {
      window.close();
    } catch {
      window.location.href = orgId
        ? `/organizations/${orgId}/settings/integrations/zoho`
        : '/home';
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
        padding: '24px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          backgroundColor: '#fff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
          padding: '32px 28px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        {isSuccess ? (
          <>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#dcfce7',
                color: '#16a34a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckCircle2 size={32} />
            </div>

            <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--navy-900)', margin: 0 }}>
              Zoho Books Authorized Successfully
            </h1>

            <p style={{ fontSize: '14px', color: '#475569', lineHeight: '1.5', margin: 0 }}>
              Your Zoho account has been connected. You can now select your organization in the main window.
            </p>

            <div
              style={{
                padding: '8px 16px',
                backgroundColor: '#f1f5f9',
                borderRadius: '20px',
                fontSize: '12px',
                color: '#64748b',
                fontWeight: 500,
              }}
            >
              This window will close automatically in {countdown}s
            </div>

            <button
              type="button"
              onClick={handleManualClose}
              style={{
                marginTop: '8px',
                padding: '9px 24px',
                backgroundColor: 'var(--navy-900)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <X size={16} />
              Close Tab
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#fee2e2',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertCircle size={32} />
            </div>

            <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#991b1b', margin: 0 }}>
              Zoho Authorization Failed
            </h1>

            <p style={{ fontSize: '14px', color: '#475569', lineHeight: '1.5', margin: 0 }}>
              {errorMessage}
            </p>

            <div
              style={{
                padding: '8px 16px',
                backgroundColor: '#f1f5f9',
                borderRadius: '20px',
                fontSize: '12px',
                color: '#64748b',
                fontWeight: 500,
              }}
            >
              This window will close automatically in {countdown}s
            </div>

            <button
              type="button"
              onClick={handleManualClose}
              style={{
                marginTop: '8px',
                padding: '9px 24px',
                backgroundColor: '#374151',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <X size={16} />
              Close Window
            </button>
          </>
        )}
      </div>
    </div>
  );
}
