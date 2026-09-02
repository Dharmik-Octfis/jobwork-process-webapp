import { useState } from 'react';
import { useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, SlidersHorizontal, Settings } from 'lucide-react';
import { assembliesApi, type ItemAssembly } from './assemblies.api';

import { AssemblyDetail } from './AssemblyDetail';
import { useListSearch } from '../../../hooks/useListSearch';
import { useListCount } from '../../../hooks/useListCount';
import { useListColumns } from '../../../hooks/useListColumns';
import { ListFilterDropdown } from '../../../components/ui/ListFilterDropdown';
import { Pagination } from '../../../components/ui/Pagination';
import { CustomizeColumnsModal } from '../../../components/ui/CustomizeColumnsModal';
import { BulkActionBar } from '../../../components/ui/BulkActionBar';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { formatDate } from '../../../lib/formatDate';

function renderAssemblyCell(assembly: ItemAssembly, colKey: string) {
  switch (colKey) {
    case 'assemblyNumber':
      return <span style={{ fontWeight: 500, color: '#0062ff' }}>{assembly.assemblyNumber}</span>;
    case 'assemblyDate':
      return formatDate(assembly.assemblyDate);
    case 'compositeItem':
      return assembly.compositeItem?.name || assembly.compositeItemId;
    case 'qty':
      return assembly.qty;
    case 'totalValue':
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
      }).format(assembly.totalValue);
    case 'status':
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 500,
            background:
              assembly.status === 'assembled'
                ? '#dcfce7'
                : assembly.status === 'cancelled'
                  ? '#fee2e2'
                  : '#f1f5f9',
            color:
              assembly.status === 'assembled'
                ? '#166534'
                : assembly.status === 'cancelled'
                  ? '#991b1b'
                  : '#475569',
            textTransform: 'capitalize',
          }}
        >
          {assembly.status}
        </span>
      );
    case 'direction':
      return <span style={{ textTransform: 'capitalize' }}>{assembly.direction}</span>;
    case 'createdAt':
      return formatDate(assembly.createdAt);
    default:
      return (assembly as unknown as Record<string, string | number>)[colKey] || '-';
  }
}

export function AssemblyList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id');

  const { search, filter, setFilter, perPage, setPerPage, page, setPage } = useListSearch();

  const { data, isLoading } = useQuery({
    queryKey: ['assemblies', orgId, search, filter, page, perPage],
    queryFn: () =>
      assembliesApi.getAssemblies(orgId!, { search: search || undefined, filter, page, perPage }),
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });

  const assemblies = data?.results ?? [];
  const pageContext = data?.pageContext;

  const {
    total,
    isCounting,
    request: requestCount,
  } = useListCount(['assemblies-count', orgId, search, filter], () =>
    assembliesApi.getAssemblyCount(orgId!, { search: search || undefined, filter }),
  );

  const {
    catalog,
    visible,
    columns,
    filters,
    save: saveColumns,
  } = useListColumns(orgId, 'item_assembly');
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  const headerStyle = {
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase' as const,
  };

  const handleDeleteSelected = async () => {
    setIsBulkDeleteDialogOpen(true);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === assemblies.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(assemblies.map((i) => i.id));
    }
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
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#f8fafc' }}>
        <div
          style={{
            flex: selectedId ? '0 0 320px' : 1,
            borderRight: selectedId ? '1px solid #eef0f3' : 'none',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
          }}
        >
          {!selectedId && selectedIds.length > 0 ? (
            <BulkActionBar
              selectedCount={selectedIds.length}
              onClearSelection={() => setSelectedIds([])}
              onDelete={handleDeleteSelected}
              isProcessing={isProcessing}
            />
          ) : (
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
              <ListFilterDropdown
                filters={filters}
                value={filter}
                onChange={setFilter}
                fallbackLabel="All Assemblies"
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {!selectedId && (
                  <button
                    type="button"
                    onClick={() => setIsColumnsOpen(true)}
                    title="Customize Columns"
                    aria-label="Customize Columns"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 30,
                      height: 30,
                      borderRadius: 4,
                      border: '1px solid #e2e8f0',
                      background: '#fff',
                      cursor: 'pointer',
                      color: '#64748b',
                    }}
                  >
                    <SlidersHorizontal size={15} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate(`/organizations/${orgId}/inventory/assembly/new`, { state: { returnUrl: location.pathname + location.search } })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    background: '#0062ff',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={16} />
                  <span>New</span>
                </button>
              </div>
            </header>
          )}

          <div style={{ flex: 1, overflow: 'auto' }}>
            {selectedId ? (
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
                  Assemblies
                </div>
                {isLoading ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                    Loading...
                  </div>
                ) : assemblies.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                    No assemblies found
                  </div>
                ) : (
                  assemblies.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSearchParams({ id: item.id })}
                      style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid #eef0f3',
                        cursor: 'pointer',
                        background: selectedId === item.id ? '#f1f5f9' : 'transparent',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => {
                        if (selectedId !== item.id) e.currentTarget.style.background = '#f8fafc';
                      }}
                      onMouseLeave={(e) => {
                        if (selectedId !== item.id)
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
                        {item.assemblyNumber}
                      </div>
                      <div style={{ fontSize: '13px', color: '#334155', marginBottom: '8px' }}>
                        {item.compositeItem?.name || '-'}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 500,
                            background:
                              item.status === 'assembled'
                                ? '#dcfce7'
                                : item.status === 'cancelled'
                                  ? '#fee2e2'
                                  : '#f1f5f9',
                            color:
                              item.status === 'assembled'
                                ? '#166534'
                                : item.status === 'cancelled'
                                  ? '#991b1b'
                                  : '#475569',
                            textTransform: 'uppercase',
                          }}
                        >
                          {item.status}
                        </span>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          {formatDate(item.assemblyDate)}
                        </span>
                      </div>
                  </div>
                  ))
                )}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 48, ...headerStyle, paddingRight: 0, textAlign: 'center', borderBottom: '1px solid #eef0f3' }}>
                      <input
                        type="checkbox"
                        checked={assemblies.length > 0 && selectedIds.length === assemblies.length}
                        onChange={toggleAll}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        style={{
                          ...headerStyle,
                          borderBottom: '1px solid #eef0f3',
                          display: selectedId && !col.locked ? 'none' : 'table-cell',
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan={columns.length}
                        style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}
                      >
                        Loading...
                      </td>
                    </tr>
                  ) : assemblies.length === 0 ? (
                    <tr>
                      <td
                        colSpan={columns.length}
                        style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}
                      >
                        <Settings size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>
                          No assemblies found
                        </div>
                        <div style={{ fontSize: 13, marginTop: 4 }}>
                          Create a new assembly to get started.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    assemblies.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => setSearchParams({ id: item.id })}
                        style={{
                          borderBottom: '1px solid #eef0f3',
                          cursor: 'pointer',
                          background: selectedIds.includes(item.id) ? '#f8fafc' : 'transparent',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#f8fafc';
                        }}
                        onMouseLeave={(e) => {
                          if (!selectedIds.includes(item.id))
                            e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <td style={{ width: 48, padding: '12px 16px', paddingRight: 0, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(item.id)}
                            onChange={() => toggleSelection(item.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            style={{
                              padding: '12px 16px',
                              fontSize: 13,
                              color: col.locked ? '#0062ff' : '#333',
                              fontWeight: col.locked ? 500 : 400,
                              display: selectedId && !col.locked ? 'none' : 'table-cell',
                            }}
                          >
                            {renderAssemblyCell(item, col.key)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {!selectedId && (
            <Pagination
              pageContext={pageContext}
              perPage={perPage}
              page={page}
              onPageChange={setPage}
              onPerPageChange={setPerPage}
              total={total}
              isCounting={isCounting}
              onRequestCount={requestCount}
            />
          )}
        </div>

        {selectedId && (
          <div
            style={{
              flex: 1,
              borderLeft: '1px solid #eef0f3',
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
            }}
          >
            <AssemblyDetail
              orgId={orgId!}
              assemblyId={selectedId}
              onClose={() => setSearchParams({})}
            />
          </div>
        )}
      </div>

      <CustomizeColumnsModal
        isOpen={isColumnsOpen}
        onClose={() => setIsColumnsOpen(false)}
        catalog={catalog}
        visible={visible}
        onSave={saveColumns.mutate}
        isSaving={saveColumns.isPending}
      />

      <ConfirmDialog
        isOpen={isBulkDeleteDialogOpen}
        title="Delete Selected Assemblies"
        message={`Are you sure you want to delete ${selectedIds.length} assembly(s)? This action cannot be undone.`}
        confirmText={isProcessing ? 'Deleting...' : 'Delete'}
        onConfirm={async () => {
          setIsProcessing(true);
          try {
            await Promise.allSettled(
              selectedIds.map(id => assembliesApi.deleteAssembly(orgId!, id))
            );
            setSelectedIds([]);
            window.location.reload();
          } finally {
            setIsProcessing(false);
            setIsBulkDeleteDialogOpen(false);
          }
        }}
        onCancel={() => setIsBulkDeleteDialogOpen(false)}
      />
    </div>
  );
}
