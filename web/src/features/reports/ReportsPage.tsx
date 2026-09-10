import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Folder, Star } from 'lucide-react';

export function ReportsPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const [activeCategory, setActiveCategory] = useState('Inventory Valuation');

  return (
    <div
      style={{
        background: '#f8fafc',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#fff',
          borderBottom: '1px solid #eef0f3',
          padding: '16px 24px',
        }}
      >
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#1e293b', margin: 0 }}>
          Reports Center
        </h1>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px',
            borderRadius: '50%',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div
          style={{
            width: '230px',
            background: '#fff',
            borderRight: '1px solid #eef0f3',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 12px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#94a3b8',
              textTransform: 'uppercase',
              padding: '0 12px',
              marginBottom: '12px',
            }}
          >
            Report Category
          </div>
          <div
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              background: activeCategory === 'Inventory Valuation' ? '#f1f5f9' : 'transparent',
              borderRadius: '6px',
              color: activeCategory === 'Inventory Valuation' ? '#0f172a' : '#475569',
              fontWeight: 500,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
            onClick={() => setActiveCategory('Inventory Valuation')}
          >
            <Folder
              size={16}
              color={activeCategory === 'Inventory Valuation' ? '#0062ff' : '#94a3b8'}
              strokeWidth={1.5}
            />
            Inventory Valuation
          </div>
        </div>

        {/* Main Content */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto', background: '#f8fafc' }}>
          <div
            style={{
              background: '#fff',
              borderRadius: '8px',
              border: '1px solid #eef0f3',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              overflow: 'hidden',
            }}
          >
            {/* Table Header Area */}
            <div
              style={{
                padding: '16px 24px',
                borderBottom: '1px solid #eef0f3',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', margin: 0 }}>
                Inventory Valuation
              </h2>
              <span
                style={{
                  background: '#eff6ff',
                  color: '#0062ff',
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '12px',
                }}
              >
                1
              </span>
            </div>

            {/* Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #eef0f3' }}>
                  <th
                    style={{
                      padding: '12px 24px',
                      textAlign: 'left',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      width: '40%',
                    }}
                  >
                    Report Name
                  </th>
                  <th
                    style={{
                      padding: '12px 24px',
                      textAlign: 'left',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      width: '30%',
                    }}
                  >
                    Created By
                  </th>
                  <th
                    style={{
                      padding: '12px 24px',
                      textAlign: 'left',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      width: '30%',
                    }}
                  >
                    Last Visited
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  style={{ borderBottom: '1px solid #eef0f3', cursor: 'pointer', transition: 'background-color 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onClick={() => navigate(`/organizations/${orgId}/reports/inventory-valuation-summary`)}
                >
                  <td style={{ padding: '14px 24px', fontSize: '13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Star size={16} color="#cbd5e1" strokeWidth={1.5} />
                      <span style={{ color: '#0062ff', fontWeight: 500 }}>
                        Inventory Valuation Summary
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '14px 24px', fontSize: '13px', color: '#334155', fontWeight: 400 }}>
                    System Generated
                  </td>
                  <td style={{ padding: '14px 24px', fontSize: '13px', color: '#334155', fontWeight: 400 }}>
                    -
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
