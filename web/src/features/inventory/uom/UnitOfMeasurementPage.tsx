import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, ChevronDown, Package } from 'lucide-react';
import { useUoms, useDeleteUom } from './uom.api';
import { UomFormModal } from './UomFormModal';
import type { Uom } from './uom.schemas';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';

/* eslint-disable @typescript-eslint/naming-convention */
const UQC_MAPPING: Record<string, string> = {
  OTH: 'OTH (Others)',
  BOU: 'BOU (Billion of units)',
  BGS: 'BGS (Bags)',
  BAL: 'BAL (Bale)',
  BTL: 'BTL (Bottles)',
  BOX: 'BOX (Boxes)',
  BKL: 'BKL (Buckles)',
  BUN: 'BUN (Bunches)',
  BDL: 'BDL (Bundles)',
  CAN: 'CAN (Cans)',
  CBM: 'CBM (Cubic Meters)',
  CCM: 'CCM (Cubic Centimeters)',
  CMS: 'CMS (Centimeters)',
  CTN: 'CTN (Cartons)',
  DOZ: 'DOZ (Dozens)',
  DRM: 'DRM (Drums)',
  GGK: 'GGK (Great Gross)',
  GMS: 'GMS (Grams)',
  GRS: 'GRS (Gross)',
  GYD: 'GYD (Gross Yards)',
  KGS: 'KGS (Kilograms)',
  KLR: 'KLR (Kilolitre)',
  KME: 'KME (Kilometre)',
  LTR: 'LTR (Litres)',
  MLT: 'MLT (Millilitre)',
  MTR: 'MTR (Meters)',
  MTS: 'MTS (Metric Tonnes)',
  NOS: 'NOS (Numbers)',
  PAC: 'PAC (Packs)',
  PCS: 'PCS (Pieces)',
  PRS: 'PRS (Pairs)',
  QTL: 'QTL (Quintal)',
  ROL: 'ROL (Rolls)',
  SET: 'SET (Sets)',
  SQF: 'SQF (Square Feet)',
  SQM: 'SQM (Square Meters)',
  SQY: 'SQY (Square Yards)',
  TBS: 'TBS (Tablets)',
  TGM: 'TGM (Ten Gross)',
  THD: 'THD (Thousands)',
  TON: 'TON (Tonnes)',
  TUB: 'TUB (Tubes)',
  UGS: 'UGS (US Gallons)',
  UNT: 'UNT (Units)',
  YDS: 'YDS (Yards)',
};
/* eslint-enable @typescript-eslint/naming-convention */

export function UnitOfMeasurementPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: uoms = [], isLoading, error } = useUoms(orgId!);
  const deleteMutation = useDeleteUom(orgId!);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uomToEdit, setUomToEdit] = useState<Uom | null>(null);
  const [uomToDelete, setUomToDelete] = useState<string | null>(null);

  const handleEdit = (uom: Uom) => {
    setUomToEdit(uom);
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
        Error loading units of measurement.
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
                Units of Measurement
              </h1>
              <ChevronDown size={16} color="#0062ff" strokeWidth={2.5} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                onClick={() => {
                  setUomToEdit(null);
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
                <Plus size={16} /> New Unit
              </button>
            </div>
          </header>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                Loading units of measurement...
              </div>
            ) : uoms.length === 0 ? (
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
                  <Package size={40} color="#94a3b8" />
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}>
                  No Units of Measurement
                </h2>
                <p style={{ color: '#64748b', maxWidth: 400, margin: '0 0 24px 0', lineHeight: 1.5 }}>
                  You haven't added any units of measurement yet. Create your first unit to manage items in your inventory.
                </p>
                <button
                  onClick={() => {
                    setUomToEdit(null);
                    setIsModalOpen(true);
                  }}
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
                  Create Unit
                </button>
              </div>
            ) : (
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr
                      style={{
                        background: '#f9f9fb',
                        borderTop: '1px solid #eef0f3',
                        borderBottom: '1px solid #eef0f3',
                      }}
                    >
                      <th style={headerStyle}>UNIT NAME</th>
                      <th style={headerStyle}>SYMBOL</th>
                      <th style={headerStyle}>UQC</th>
                      <th style={headerStyle}>UNIT PRECISION</th>
                      <th style={{ ...headerStyle, width: 100 }}>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uoms.map((uom) => (
                      <tr
                        key={uom.id}
                        style={{ borderBottom: '1px solid #eef0f3', transition: 'background 0.1s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '12px 16px', color: '#1e293b', fontSize: 13, fontWeight: 500 }}>
                          {uom.unitName}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 13 }}>
                          {uom.symbol}
                        </td>
                        <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 13 }}>
                          <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                            {UQC_MAPPING[uom.uqc] || uom.uqc}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 13 }}>
                          {uom.unitPrecision}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', gap: 12 }}>
                            <button
                              onClick={() => handleEdit(uom)}
                              title="Edit"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 0 }}
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => setUomToDelete(uom.id)}
                              title="Delete"
                              disabled={deleteMutation.isPending}
                              style={{ background: 'none', border: 'none', cursor: deleteMutation.isPending ? 'not-allowed' : 'pointer', color: '#ef4444', padding: 0 }}
                            >
                              <Trash2 size={16} />
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

      <UomFormModal
        orgId={orgId!}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        uomToEdit={uomToEdit}
      />

      <ConfirmDialog
        isOpen={!!uomToDelete}
        title="Delete Unit of Measurement"
        message="Are you sure you want to delete this unit of measurement? This action cannot be undone."
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => {
          if (uomToDelete) {
            deleteMutation.mutate(uomToDelete, {
              onSuccess: () => setUomToDelete(null)
            });
          }
        }}
        onCancel={() => setUomToDelete(null)}
      />
    </div>
  );
}
