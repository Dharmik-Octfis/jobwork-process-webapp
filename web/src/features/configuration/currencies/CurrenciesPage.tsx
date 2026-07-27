import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, ChevronDown, Coins } from 'lucide-react';
import { useCurrencies, useDeleteCurrency } from './currencies.api';
import { CurrencyFormModal } from './CurrencyFormModal';
import type { Currency } from './currencies.schemas';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';

export function CurrenciesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: currencies = [], isLoading, error } = useCurrencies(orgId!);
  const deleteMutation = useDeleteCurrency(orgId!);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currencyToEdit, setCurrencyToEdit] = useState<Currency | null>(null);
  const [currencyToDelete, setCurrencyToDelete] = useState<string | null>(null);

  const handleEdit = (currency: Currency) => {
    setCurrencyToEdit(currency);
    setIsModalOpen(true);
  };

  const headerStyle = {
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase' as const,
  };

  if (error) {
    return (
      <div style={{ padding: '32px', color: '#dc2626', textAlign: 'center' }}>
        Error loading currencies.
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff' }}>
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 24px',
              background: '#fff',
              borderBottom: '1px solid #eef0f3',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#000', margin: 0 }}>
                Currencies
              </h1>
              <ChevronDown size={16} color="var(--color-primary)" strokeWidth={2.5} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                onClick={() => {
                  setCurrencyToEdit(null);
                  setIsModalOpen(true);
                }}
                style={{
                  background: '#186337',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontWeight: 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Plus size={16} /> New Currency
              </button>
            </div>
          </header>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                Loading...
              </div>
            ) : currencies.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '64px 24px',
                  textAlign: 'center',
                  background: '#fff',
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'var(--primary-50)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}
                >
                  <Coins size={24} color="var(--color-primary)" />
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: '#0f172a' }}>
                  No Currencies found
                </h3>
                <p style={{ margin: '0 0 24px 0', color: '#64748b', fontSize: 14, maxWidth: 300 }}>
                  Get started by adding your first currency.
                </p>
                <button
                  onClick={() => {
                    setCurrencyToEdit(null);
                    setIsModalOpen(true);
                  }}
                  style={{
                    background: '#fff',
                    color: 'var(--color-primary)',
                    border: '1px solid var(--color-border)',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 500,
                    fontSize: 14,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <Plus size={16} />
                  Add Currency
                </button>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', background: '#f8fafc' }}>
                    <th style={{ ...headerStyle, width: '30%', textAlign: 'left' }}>Currency Name</th>
                    <th style={{ ...headerStyle, width: '65%', textAlign: 'left' }}>Symbol</th>
                    <th style={{ ...headerStyle, width: '5%', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currencies.map((currency) => (
                    <tr
                      key={currency.id}
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        background: '#fff',
                      }}
                    >
                      <td style={{ padding: '12px 16px', color: 'var(--color-text)', fontWeight: 500 }}>
                        {currency.currencyName}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--color-text)' }}>
                        {currency.symbol}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: 8,
                          }}
                        >
                          <button
                            onClick={() => handleEdit(currency)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 6,
                              cursor: 'pointer',
                              color: '#64748b',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px',
                            }}
                            title="Edit"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => setCurrencyToDelete(currency.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 6,
                              cursor: 'pointer',
                              color: '#dc2626',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px',
                            }}
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <CurrencyFormModal
        orgId={orgId!}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setCurrencyToEdit(null);
        }}
        currencyToEdit={currencyToEdit}
      />

      <ConfirmDialog
        isOpen={!!currencyToDelete}
        onCancel={() => setCurrencyToDelete(null)}
        onConfirm={async () => {
          if (currencyToDelete) {
            await deleteMutation.mutateAsync(currencyToDelete);
            setCurrencyToDelete(null);
          }
        }}
        title="Delete Currency"
        message="Are you sure you want to delete this currency? This action cannot be undone."
        confirmText="Delete"
        isConfirming={deleteMutation.isPending}
      />
    </div>
  );
}
