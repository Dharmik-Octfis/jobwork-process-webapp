import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCustomers, deleteCustomer } from './customers.api';
import { Plus, ChevronDown, Building2 } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { CustomerDetail } from './CustomerDetail';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Pagination } from '../../../components/ui/Pagination';
import { useListSearch } from '../../../hooks/useListSearch';

// removed formatGstTreatment

export function CustomersList() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCustomerId = searchParams.get('id');

  // Search term (from the global top-bar box, via `?search=`) + page cursor.
  const { search, page, setPage } = useListSearch();

  const { data, isLoading } = useQuery({
    queryKey: ['customers', orgId, search, page],
    queryFn: () => fetchCustomers(orgId!, { search: search || undefined, page }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const customers = data?.results ?? [];
  const pageContext = data?.pageContext;

  const queryClient = useQueryClient();
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCustomer(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', orgId] });
      setCustomerToDelete(null);
    },
  });

  const headerStyle = {
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase' as const,
  };

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
      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}>
        <div
          style={{
            flex: selectedCustomerId ? '0 0 320px' : 1,
            borderRight: selectedCustomerId ? '1px solid #eef0f3' : 'none',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
          }}
        >
          {/* Page Header */}
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 24px',
              background: '#fff',
              borderBottom: '1px solid #eef0f3',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#000', margin: 0 }}>
                All Customers
              </h1>
              <ChevronDown size={16} color="#0062ff" strokeWidth={2.5} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {!selectedCustomerId && (
                <button
                  onClick={() => navigate(`/organizations/${orgId}/sales/customers/new`)}
                  style={{
                    background: '#0062ff',
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
                  <Plus size={16} /> New
                </button>
              )}
            </div>
          </header>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                Loading customers...
              </div>
            ) : customers.length === 0 && search ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: '#64748b' }}>
                No customers match &ldquo;{search}&rdquo;.
              </div>
            ) : customers.length === 0 ? (
              <div
                style={{
                  padding: '64px 32px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    background: '#f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '16px',
                  }}
                >
                  <Building2 size={40} color="#94a3b8" />
                </div>
                <h2
                  style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}
                >
                  No Customers Yet
                </h2>
                <p
                  style={{ color: '#64748b', maxWidth: 400, margin: '0 0 24px 0', lineHeight: 1.5 }}
                >
                  You haven't added any customers yet. Create your first customer to start creating
                  purchase orders and bills.
                </p>
                <button
                  onClick={() => navigate(`/organizations/${orgId}/sales/customers/new`)}
                  style={{
                    background: '#28a745',
                    color: 'white',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: '4px',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Create Customer
                </button>
              </div>
            ) : (
              <div>
                {selectedCustomerId ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div
                      style={{
                        padding: '8px 16px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#64748b',
                        background: '#f9f9fb',
                        borderBottom: '1px solid #eef0f3',
                      }}
                    >
                      All Customers
                    </div>
                    {customers.map((customer) => (
                      <div
                        key={customer.id}
                        onClick={() => setSearchParams({ id: customer.id })}
                        style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid #eef0f3',
                          cursor: 'pointer',
                          background:
                            selectedCustomerId === customer.id ? '#f1f5f9' : 'transparent',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          if (selectedCustomerId !== customer.id)
                            e.currentTarget.style.background = '#f8fafc';
                        }}
                        onMouseLeave={(e) => {
                          if (selectedCustomerId !== customer.id)
                            e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: 500,
                            color: '#1e293b',
                            marginBottom: '4px',
                          }}
                        >
                          {customer.displayName}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {customer.companyName || customer.emailAddress || 'No email'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr
                        style={{
                          background: '#f9f9fb',
                          borderTop: '1px solid #eef0f3',
                          borderBottom: '1px solid #eef0f3',
                        }}
                      >
                        <th style={headerStyle}>NAME</th>
                        <th style={headerStyle}>COMPANY NAME</th>
                        <th style={headerStyle}>VENDOR NUMBER</th>
                        <th style={headerStyle}>WORK PHONE</th>
                        <th style={headerStyle}>EMAIL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((customer) => (
                        <tr
                          key={customer.id}
                          onClick={() => setSearchParams({ id: customer.id })}
                          style={{
                            borderBottom: '1px solid #eef0f3',
                            transition: 'background 0.1s',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <td
                            style={{
                              padding: '12px 16px',
                              color: '#0062ff',
                              fontSize: 13,
                              fontWeight: 500,
                            }}
                          >
                            {customer.displayName}
                          </td>
                          <td style={{ padding: '12px 16px', color: '#333', fontSize: 13 }}>
                            {customer.companyName || '-'}
                          </td>
                          <td style={{ padding: '12px 16px', color: '#333', fontSize: 13 }}>
                            {customer.customerNumber}
                          </td>
                          <td style={{ padding: '12px 16px', color: '#333', fontSize: 13 }}>
                            {customer.workPhone || '-'}
                          </td>
                          <td style={{ padding: '12px 16px', color: '#333', fontSize: 13 }}>
                            {customer.emailAddress || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* Pagination — hidden while a customer is selected (narrow master pane) */}
          {!selectedCustomerId && (
            <Pagination pageContext={pageContext} page={page} onPageChange={setPage} />
          )}
        </div>

        {/* Right Panel - Detail */}
        {selectedCustomerId && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <CustomerDetail customerId={selectedCustomerId} onClose={() => setSearchParams({})} />
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!customerToDelete}
        title="Delete Customer"
        message="Are you sure you want to delete this customer? This action cannot be undone."
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => {
          if (customerToDelete) {
            deleteMutation.mutate(customerToDelete);
          }
        }}
        onCancel={() => setCustomerToDelete(null)}
      />
    </div>
  );
}
