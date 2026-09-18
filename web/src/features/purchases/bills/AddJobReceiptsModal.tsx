import React, { useState, useMemo } from 'react';
import { X, Search } from 'lucide-react';
import { format } from 'date-fns';

interface JobReceiptOutput {
  id: string;
  item: { id: string; name: string; sku: string | null };
  acceptedQty: number;
  rate: number;
  processCharge: number;
  itemId: string;
  outputBatch?: { batchNumber: string };
}

export interface OpenJobReceipt {
  id: string;
  receiptNumber: string;
  receiptDate: string;
  jobOrder: { jobOrderNumber: string };
  location: { name: string };
  processChargeTotal: number;
  outputs: JobReceiptOutput[];
}

interface AddJobReceiptsModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobReceipts: OpenJobReceipt[];
  onAdd: (selected: OpenJobReceipt[]) => void;
}

export const AddJobReceiptsModal: React.FC<AddJobReceiptsModalProps> = ({
  isOpen,
  onClose,
  jobReceipts,
  onAdd,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setSearchTerm('');
      setSelectedIds(new Set());
    }
  }

  const filteredReceipts = useMemo(() => {
    if (!searchTerm) return jobReceipts;
    const lower = searchTerm.toLowerCase();
    return jobReceipts.filter(
      (jr) =>
        jr.receiptNumber.toLowerCase().includes(lower) ||
        jr.jobOrder.jobOrderNumber.toLowerCase().includes(lower) ||
        jr.location.name.toLowerCase().includes(lower),
    );
  }, [jobReceipts, searchTerm]);

  const groupedReceipts = useMemo(() => {
    const groups: Record<string, OpenJobReceipt[]> = {};
    filteredReceipts.forEach((jr) => {
      const key = jr.jobOrder.jobOrderNumber;
      if (!groups[key]) groups[key] = [];
      groups[key].push(jr);
    });
    return groups;
  }, [filteredReceipts]);

  if (!isOpen) return null;

  const allSelected =
    filteredReceipts.length > 0 && selectedIds.size === filteredReceipts.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < filteredReceipts.length;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredReceipts.map((r) => r.id)));
    }
  };

  const toggleSelection = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
  };

  const handleAdd = () => {
    const selectedReceipts = jobReceipts.filter((jr) => selectedIds.has(jr.id));
    onAdd(selectedReceipts);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '0 0 8px 8px',
          width: '840px',
          height: '345px',
          maxWidth: '90%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
              Add Open Job Receives
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              padding: '4px',
              display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '300px',
            }}
          >
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#64748b',
              }}
            />
            <input
              type="text"
              placeholder="Search receives..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 12px 6px 30px',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                fontSize: '12px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead
              style={{
                background: '#f8fafc',
                position: 'sticky',
                top: 0,
                boxShadow: '0 1px 0 #e2e8f0',
              }}
            >
              <tr>
                <th
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: '#475569',
                    width: '180px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = isIndeterminate;
                      }}
                      onChange={handleSelectAll}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>JOB ORDER NO</span>
                  </div>
                </th>
                <th
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: '#475569',
                  }}
                >
                  RECEIVE NO
                </th>
                <th
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: '#475569',
                  }}
                >
                  LOCATION
                </th>
                <th
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: '#475569',
                  }}
                >
                  DATE
                </th>
                <th
                  style={{
                    padding: '8px 12px',
                    textAlign: 'right',
                    fontWeight: 600,
                    color: '#475569',
                  }}
                >
                  AMOUNT
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groupedReceipts).flatMap(([jobOrderNumber, receipts]) => {
                const groupAllSelected = receipts.every((r) => selectedIds.has(r.id));
                const groupSomeSelected = receipts.some((r) => selectedIds.has(r.id));

                return receipts.map((jr, index) => (
                  <tr
                    key={jr.id}
                    style={{
                      borderBottom: '1px solid #e2e8f0',
                      cursor: 'pointer',
                      background: selectedIds.has(jr.id) ? '#f0f9ff' : 'white',
                    }}
                    onClick={() => toggleSelection(jr.id)}
                  >
                    {index === 0 && (
                      <td
                        rowSpan={receipts.length}
                        style={{ padding: '6px 12px', verticalAlign: 'top', background: 'white', borderRight: '1px solid #e2e8f0' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={groupAllSelected}
                            ref={(input) => {
                              if (input) input.indeterminate = groupSomeSelected && !groupAllSelected;
                            }}
                            onChange={() => {
                              const newSelection = new Set(selectedIds);
                              if (groupAllSelected) {
                                receipts.forEach((r) => newSelection.delete(r.id));
                              } else {
                                receipts.forEach((r) => newSelection.add(r.id));
                              }
                              setSelectedIds(newSelection);
                            }}
                            style={{ cursor: 'pointer' }}
                          />
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>{jobOrderNumber}</span>
                        </div>
                      </td>
                    )}
                    <td style={{ padding: '6px 12px', color: '#0f172a' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(jr.id)}
                          onChange={() => toggleSelection(jr.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ cursor: 'pointer' }}
                        />
                        <span>{jr.receiptNumber}</span>
                      </div>
                    </td>
                    <td style={{ padding: '6px 12px', color: '#475569' }}>{jr.location.name}</td>
                    <td style={{ padding: '6px 12px', color: '#475569' }}>
                      {format(new Date(jr.receiptDate), 'dd MMM yyyy')}
                    </td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', color: '#0f172a' }}>
                      ₹{jr.outputs.reduce((sum, o) => sum + Number(o.processCharge || 0), 0).toFixed(2)}
                    </td>
                  </tr>
                ));
              })}
              {filteredReceipts.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                    No job receives found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderRadius: '0 0 8px 8px',
          }}
        >
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            {selectedIds.size} receives selected
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '6px 12px',
                background: 'white',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                color: '#475569',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '12px',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={selectedIds.size === 0}
              style={{
                padding: '6px 12px',
                background: selectedIds.size > 0 ? '#2563eb' : '#94a3b8',
                border: 'none',
                borderRadius: '6px',
                color: 'white',
                cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
                fontWeight: 500,
                fontSize: '12px',
              }}
            >
              Add Selected ({selectedIds.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
