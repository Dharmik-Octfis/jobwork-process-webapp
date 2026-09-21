import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import '../../users/Users.css';

const CURRENCY_FILTERS = [
  { key: 'active', label: 'Active Currencies' },
  { key: 'inactive', label: 'Inactive Currencies' },
  { key: 'all', label: 'All Currencies' },
];
import { Plus, Edit2, Coins, Info } from 'lucide-react';
import { format } from 'date-fns';
import { useCurrencies, useUpdateCurrency } from './currencies.api';
import { CurrencyFormModal } from './CurrencyFormModal';
import type { Currency } from './currencies.schemas';

export function CurrenciesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') ?? 'active';

  const setFilter = (key: string) => {
    setParams(
      (prev) => {
        if (key === 'active') {
          prev.delete('filter');
        } else {
          prev.set('filter', key);
        }
        return prev;
      },
      { replace: true },
    );
  };

  const { data: currencies = [], isLoading, error } = useCurrencies(orgId!);
  const updateMutation = useUpdateCurrency(orgId!);

  const filteredCurrencies = currencies.filter((currency) => {
    if (filter === 'active') return currency.isActive;
    if (filter === 'inactive') return !currency.isActive;
    return true;
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currencyToEdit, setCurrencyToEdit] = useState<Currency | null>(null);
  const [isSetBaseModalOpen, setIsSetBaseModalOpen] = useState(false);
  const [selectedBaseCurrencyId, setSelectedBaseCurrencyId] = useState<string>('');

  const hasBaseCurrency = currencies.some((c) => c.isBaseCurrency);

  const handleToggleStatus = async (currency: Currency) => {
    if (currency.isBaseCurrency) return;
    await updateMutation.mutateAsync({
      id: currency.id,
      data: { isActive: !currency.isActive },
    });
  };

  const handleEdit = (currency: Currency) => {
    setCurrencyToEdit(currency);
    setIsModalOpen(true);
  };

  const handleConfirmBaseCurrencySelection = async () => {
    const targetId = selectedBaseCurrencyId || currencies[0]?.id;
    if (!targetId) return;
    await updateMutation.mutateAsync({
      id: targetId,
      data: { isBaseCurrency: true },
    });
    setIsSetBaseModalOpen(false);
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
              <ListFilterDropdown
                filters={CURRENCY_FILTERS}
                value={filter}
                onChange={setFilter}
                fallbackLabel="Active Currencies"
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {!hasBaseCurrency && currencies.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBaseCurrencyId(currencies[0]?.id || '');
                    setIsSetBaseModalOpen(true);
                  }}
                  style={{
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    border: '1px solid #bfdbfe',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontWeight: 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  Set Base Currency
                </button>
              )}
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
            ) : filteredCurrencies.length === 0 ? (
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
                {currencies.length === 0 && (
                  <>
                    <p
                      style={{
                        margin: '0 0 24px 0',
                        color: '#64748b',
                        fontSize: 14,
                        maxWidth: 300,
                      }}
                    >
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
                  </>
                )}
              </div>
            ) : (
              <div className="responsive-table-wrapper">
                    <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  tableLayout: 'fixed',
                }}
              >
                <thead>
                  <tr
                    style={{ borderBottom: '1px solid var(--color-border)', background: '#f8fafc' }}
                  >
                    <th style={{ ...headerStyle, width: '20%', textAlign: 'left' }}>
                      Currency Name
                    </th>
                    <th style={{ ...headerStyle, width: '8%', textAlign: 'left' }}>Symbol</th>
                    <th style={{ ...headerStyle, width: '10%', textAlign: 'left' }}>
                      Exchange Rate
                    </th>
                    <th style={{ ...headerStyle, width: '18%', textAlign: 'left' }}>
                      Created By & Time
                    </th>
                    <th style={{ ...headerStyle, width: '18%', textAlign: 'left' }}>
                      Modified By & Time
                    </th>
                    <th style={{ ...headerStyle, width: '10%', textAlign: 'left' }}>Status</th>
                    <th style={{ ...headerStyle, width: '16%', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCurrencies.map((currency) => (
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
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
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
                                display: 'inline-flex',
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
                      <td
                        style={{
                          padding: '12px 16px',
                          color: 'var(--color-text)',
                          textAlign: 'left',
                        }}
                      >
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
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              cursor: 'default',
                              width: 120,
                            }}
                          >
                            <div
                              style={{
                                position: 'relative',
                                width: 34,
                                height: 20,
                                borderRadius: 10,
                                background: '#22c55e',
                                opacity: 0.6,
                              }}
                            >
                              <div
                                style={{
                                  position: 'absolute',
                                  top: 2,
                                  left: 16,
                                  width: 16,
                                  height: 16,
                                  borderRadius: 8,
                                  background: '#fff',
                                }}
                              />
                            </div>
                            <span style={{ fontSize: 13, color: '#15803d', fontWeight: 500 }}>
                              Active
                            </span>
                            <span className="users-tooltip-wrapper">
                              <Info size={14} color="#94a3b8" />
                              <span className="users-tooltip-text">
                                Base currency cannot be made inactive
                              </span>
                            </span>
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
                            <span
                              style={{
                                fontSize: 13,
                                color: currency.isActive ? '#15803d' : '#64748b',
                                fontWeight: 500,
                              }}
                            >
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
                  </div>
            )}
          </div>
        </div>
      </div>

      {isSetBaseModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.4)',
            backdropFilter: 'blur(4px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '0 0 12px 12px',
              width: '100%',
              maxWidth: '440px',
              padding: '24px',
              boxShadow:
                '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: '#fef3c7',
                  color: '#d97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  flexShrink: 0,
                }}
              >
                ⚠️
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#1e293b' }}>
                  Set Base Currency
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
                  Select an active currency to set as your organization&apos;s Base Currency.
                </p>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#334155',
                  marginBottom: '6px',
                }}
              >
                Select Currency <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <SearchableSelect
                options={currencies.map((c) => ({
                  label: `${c.currencyName} (${c.currencyCode}) - ${c.symbol}`,
                  value: c.id,
                }))}
                value={selectedBaseCurrencyId}
                onChange={(val) => setSelectedBaseCurrencyId(val)}
                placeholder="Search & select currency..."
              />
            </div>

            <p
              style={{
                fontSize: '13px',
                lineHeight: '1.5',
                color: '#334155',
                marginBottom: '20px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                padding: '12px',
                borderRadius: '6px',
              }}
            >
              <strong style={{ color: '#dc2626' }}>Note:</strong> Once selected, the Base Currency
              cannot be changed or deleted later. To change the base currency in the future, a new
              organization will need to be created.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setIsSetBaseModalOpen(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#475569',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBaseCurrencySelection}
                disabled={!selectedBaseCurrencyId}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#16a34a',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Confirm & Set Base Currency
              </button>
            </div>
          </div>
        </div>
      )}

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
