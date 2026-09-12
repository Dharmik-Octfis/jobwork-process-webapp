import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Folder, Star } from 'lucide-react';
import { format } from 'date-fns';

const CATEGORIES = [
  'Inventory',
];

export function ReportsPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  // By default, nothing is selected
  const [activeCategory, setActiveCategory] = useState('');

  // Favorites state
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`favorite_reports_${orgId}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const toggleFavorite = (reportName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const newFavs = prev.includes(reportName) ? prev.filter(n => n !== reportName) : [...prev, reportName];
      localStorage.setItem(`favorite_reports_${orgId}`, JSON.stringify(newFavs));
      return newFavs;
    });
  };

  const lastVisitedInv = useMemo(() => {
    const visitedStr = localStorage.getItem(`lastVisited_inventoryValuation_${orgId}`);
    if (visitedStr) {
      try {
        return format(new Date(visitedStr), 'dd-MM-yyyy hh:mm a');
      } catch {
        // ignore
      }
    }
    return null;
  }, [orgId]);

  const lastVisitedFifo = useMemo(() => {
    const visitedStr = localStorage.getItem(`lastVisited_fifoCostLotTracking_${orgId}`);
    if (visitedStr) {
      try {
        return format(new Date(visitedStr), 'dd-MM-yyyy hh:mm a');
      } catch {
        // ignore
      }
    }
    return null;
  }, [orgId]);

  const reports = [
    { name: 'Inventory Valuation Summary', category: 'Inventory', lastVisited: lastVisitedInv || '11-09-2026 02:24 PM', route: `/organizations/${orgId}/reports/inventory-valuation-summary` },
    { name: 'FIFO Cost Lot Tracking', category: 'Inventory', lastVisited: lastVisitedFifo || '12-09-2026 10:17 AM', route: `/organizations/${orgId}/reports/fifo-cost-lot-tracking` },
  ];

  const filteredReports = activeCategory
    ? reports.filter(r => r.category === activeCategory)
    : reports;

  const sortedReports = [...filteredReports].sort((a, b) => {
    const aFav = favorites.includes(a.name);
    const bFav = favorites.includes(b.name);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return 0;
  });

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
            overflowY: 'auto',
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

          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <div
                key={cat}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  background: isActive ? '#eff6ff' : 'transparent',
                  borderRadius: '6px',
                  color: isActive ? '#0062ff' : '#475569',
                  fontWeight: 500,
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  transition: 'background-color 0.15s',
                  marginBottom: '2px',
                }}
                onClick={() => setActiveCategory(cat === activeCategory ? '' : cat)}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = '#f8fafc';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <Folder size={16} color={isActive ? '#0062ff' : '#94a3b8'} strokeWidth={1.5} />
                {cat}
              </div>
            );
          })}
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
                {activeCategory || 'All Reports'}
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
                {sortedReports.length}
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
                {sortedReports.length > 0 ? (
                  sortedReports.map((report, idx) => {
                    const isFav = favorites.includes(report.name);
                    return (
                      <tr
                        key={idx}
                        style={{ borderBottom: '1px solid #eef0f3', cursor: 'pointer', transition: 'background-color 0.15s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        onClick={() => navigate(report.route)}
                      >
                        <td style={{ padding: '14px 24px', fontSize: '13px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Star
                              size={16}
                              color={isFav ? "#f59e0b" : "#cbd5e1"}
                              fill={isFav ? "#f59e0b" : "none"}
                              strokeWidth={1.5}
                              onClick={(e) => toggleFavorite(report.name, e)}
                              style={{ transition: 'all 0.2s' }}
                            />
                            <span style={{ color: '#0062ff', fontWeight: 500 }}>
                              {report.name}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '14px 24px', fontSize: '13px', color: '#334155', fontWeight: 400 }}>
                          System Generated
                        </td>
                        <td style={{ padding: '14px 24px', fontSize: '13px', color: '#334155', fontWeight: 400 }}>
                          {report.lastVisited}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3} style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                      No reports found for this category.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
