import { ShoppingCart } from 'lucide-react';

export function PurchasesPage() {
  return (
    <div
      style={{
        padding: 'var(--space-6) var(--space-5)',
        maxWidth: 1100,
        margin: '0 auto',
        width: '100%',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: 'var(--color-text)',
              margin: '0 0 var(--space-2) 0',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
            }}
          >
            <ShoppingCart size={28} color="var(--color-primary)" />
            Purchases
          </h1>
          <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: 16 }}>
            Manage your purchase orders, bills, and vendor payments.
          </p>
        </div>
        <button
          style={{
            background: 'var(--color-primary)',
            color: 'white',
            border: 'none',
            padding: '10px 20px',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-primary-dark)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-primary)')}
        >
          + New Purchase
        </button>
      </header>

      {/* Empty State */}
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px dashed var(--color-border)',
          padding: 'var(--space-8) var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          minHeight: 400,
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'var(--color-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 'var(--space-4)',
          }}
        >
          <ShoppingCart size={40} color="var(--color-text-muted)" />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)', margin: '0 0 var(--space-2) 0' }}>
          No Purchases Yet
        </h2>
        <p style={{ color: 'var(--color-text-muted)', maxWidth: 400, margin: '0 0 var(--space-5) 0', lineHeight: 1.5 }}>
          You haven't recorded any purchases. Create your first purchase order to start tracking expenses.
        </p>
        <button
          style={{
            background: 'white',
            color: 'var(--color-primary)',
            border: '1px solid var(--color-primary)',
            padding: '10px 24px',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--color-primary-50)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'white';
          }}
        >
          Create Purchase Order
        </button>
      </div>
    </div>
  );
}
