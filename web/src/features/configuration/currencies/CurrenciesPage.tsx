import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Edit2, Coins } from 'lucide-react';
import { format } from 'date-fns';
import { useCurrencies, useUpdateCurrency } from './currencies.api';
import { CurrencyFormModal } from './CurrencyFormModal';
import type { Currency } from './currencies.schemas';

export function CurrenciesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: currencies = [], isLoading, error } = useCurrencies(orgId!);
  const updateMutation = useUpdateCurrency(orgId!);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currencyToEdit, setCurrencyToEdit] = useState<Currency | null>(null);

  const handleToggleStatus = async (currency: Currency) => {
    if (currency.isBaseCurrency) return;
    await updateMutation.mutateAsync({
      id: currency.id,
      data: { isActive: !currency.isActive }
    });
  };

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#000', margin: 0 }}>
                Currencies
              </h1>
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
              <div
                style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)' }}
              >
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
                <h3
                  style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: '#0f172a' }}
                >
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
                  <tr
                    style={{ borderBottom: '1px solid var(--color-border)', background: '#f8fafc' }}
                  >
                    <th style={{ ...headerStyle, width: '25%', textAlign: 'left' }}>
                      Currency Name
                    </th>
                    <th style={{ ...headerStyle, width: '10%', textAlign: 'left' }}>Symbol</th>
                    <th style={{ ...headerStyle, width: '15%', textAlign: 'right' }}>Exchange Rate</th>
                    <th style={{ ...headerStyle, width: '15%', textAlign: 'left' }}>
                      Created By & Time
                    </th>
                    <th style={{ ...headerStyle, width: '15%', textAlign: 'left' }}>
                      Modified By & Time
                    </th>
                    <th style={{ ...headerStyle, width: '15%', textAlign: 'left' }}>Status</th>
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
                      <td
                        style={{
                          padding: '12px 16px',
                          color: 'var(--color-text)',
                          fontWeight: 500,
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                          <span>{currency.currencyName}</span>
                          {currency.isBaseCurrency && (
                            <span
                              style={{
                                fontSize: '10px',
                                padding: '2px 6px',
                                background: '#dcfce7',
                                color: '#166534',
                                borderRadius: '4px',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                display: 'inline-flex'
                              }}
                            >
                              Base Currency
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--color-text)' }}>
                        {currency.symbol}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--color-text)', textAlign: 'right' }}>
                        {currency.exchangeRate}
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          color: 'var(--color-text-muted)',
                          fontSize: '12px',
                        }}
                      >
                        {/* Server-resolved to this organization's name for the actor
                            — see currencies.service.ts. Already non-blank, so the
                            dash is only for a payload that predates the change. */}
                        <div
                          style={{
                            fontWeight: 500,
                            color: 'var(--color-text)',
                            marginBottom: '2px',
                          }}
                        >
                          {currency.createdByName || '-'}
                        </div>
                        <div>
                          {currency.createdAt
                            ? format(new Date(currency.createdAt), 'MMM d, yyyy h:mm a')
                            : '-'}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          color: 'var(--color-text-muted)',
                          fontSize: '12px',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 500,
                            color: 'var(--color-text)',
                            marginBottom: '2px',
                          }}
                        >
                          {currency.updatedByName || '-'}
                        </div>
                        <div>
                          {currency.updatedAt
                            ? format(new Date(currency.updatedAt), 'MMM d, yyyy h:mm a')
                            : '-'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {currency.isBaseCurrency ? (
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default', width: 100 }}
                          >
                            <div style={{ position: 'relative', width: 34, height: 20, borderRadius: 10, background: '#22c55e', opacity: 0.6 }}>
                              <div style={{ position: 'absolute', top: 2, left: 16, width: 16, height: 16, borderRadius: 8, background: '#fff' }} />
                            </div>
                            <span style={{ fontSize: 13, color: '#15803d', fontWeight: 500 }}>Active</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleStatus(currency);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                              width: 100,
                              textAlign: 'left',
                            }}
                          >
                            <div
                              style={{
                                position: 'relative',
                                width: 34,
                                height: 20,
                                borderRadius: 10,
                                background: currency.isActive ? '#22c55e' : '#cbd5e1',
                                transition: 'background 0.2s ease',
                              }}
                            >
                              <div
                                style={{
                                  position: 'absolute',
                                  top: 2,
                                  left: currency.isActive ? 16 : 2,
                                  width: 16,
                                  height: 16,
                                  borderRadius: 8,
                                  background: '#fff',
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                  transition: 'left 0.2s ease',
                                }}
                              />
                            </div>
                            <span style={{ fontSize: 13, color: currency.isActive ? '#15803d' : '#64748b', fontWeight: 500 }}>
                              {currency.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </button>
                        )}
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
    </div>
  );
}
