const fs = require('fs');
const file = 'e:/octfis-project/jobwork-process-webapp/web/src/features/items/OpeningStockPage.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace imports
content = content.replace("import { Modal } from '../../../components/ui/Modal';", "import { useNavigate, useParams } from 'react-router-dom';");
content = content.replace("import { useQuery } from '@tanstack/react-query';", "import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';");

// Remove Props interface and change function signature
content = content.replace(/export interface OpeningStockLocationRow[\s\S]*?export function AddOpeningStockModal\([^)]+\) \{/m, 
  \export interface OpeningStockLocationRow {
  id: string;
  locationId: string;
  openingStock: string;
  openingStockValue: string;
  batches: OpeningStockBatchRow[];
}

const createEmptyBatch = (defaultSellingPrice = '', defaultMrp = ''): OpeningStockBatchRow => ({
  id: crypto.randomUUID(),
  batchReference: '',
  manufacturerBatch: '',
  manufacturedDate: '',
  expiryDate: '',
  sellingPrice: defaultSellingPrice,
  mrp: defaultMrp,
  quantityIn: '',
  isExisting: false,
});

const createEmptyLocation = (): OpeningStockLocationRow => ({
  id: crypto.randomUUID(),
  locationId: '',
  openingStock: '',
  openingStockValue: '',
  batches: [],
});

const toFormRows = (
  rows: ItemOpeningStockLocationRowDto[],
  isBatchTracked: boolean,
  defaultSellingPrice = '',
  defaultMrp = '',
): OpeningStockLocationRow[] => {
  return rows
    .filter((row) => row.openingStock !== null && row.openingStock !== undefined)
    .map((row) => ({
    id: row.id ?? crypto.randomUUID(),
    locationId: row.locationId,
    openingStock:
      row.openingStock !== null && row.openingStock !== undefined ? String(row.openingStock) : '',
    openingStockValue:
      row.openingStockValue !== null && row.openingStockValue !== undefined
        ? String(row.openingStockValue)
        : '',
    batches: isBatchTracked
      ? row.batches.length > 0
        ? row.batches.map((batch) => ({
            id: batch.id ?? crypto.randomUUID(),
            batchReference: String(batch.batchReference ?? ''),
            manufacturerBatch: String(batch.manufacturerBatch ?? ''),
            manufacturedDate: String(batch.manufacturedDate ?? ''),
            expiryDate: String(batch.expiryDate ?? ''),
            sellingPrice:
              batch.sellingPrice !== null &&
              batch.sellingPrice !== undefined &&
              String(batch.sellingPrice) !== ''
                ? String(batch.sellingPrice)
                : defaultSellingPrice,
            mrp:
              batch.mrp !== null && batch.mrp !== undefined && String(batch.mrp) !== ''
                ? String(batch.mrp)
                : defaultMrp,
            quantityIn: String(batch.quantityIn ?? ''),
            isExisting: Boolean(batch.batchReference),
          }))
        : []
      : [],
  }));
};

export function OpeningStockPage() {\);

// Inject state and data fetching
content = content.replace(/  const isBatchTracked = inventoryTracking === 'batch';[\s\S]*?const \[prevDefaultMrp, setPrevDefaultMrp\] = useState\(defaultMrp\);/, \  const { orgId, id: itemId } = useParams<{ orgId: string; id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: item } = useQuery({
    queryKey: ['item', orgId, itemId],
    queryFn: () => itemsApi.getItem(orgId!, itemId!),
    enabled: !!orgId && !!itemId,
  });

  const { data: initialRows } = useQuery({
    queryKey: ['itemOpeningStock', orgId, itemId],
    queryFn: () => itemsApi.getOpeningStock(orgId!, itemId!),
    enabled: !!orgId && !!itemId,
  });

  const saveOpeningStockMutation = useMutation({
    mutationFn: (rows: any[]) => itemsApi.saveOpeningStock(orgId!, itemId!, { locationRows: rows }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['itemOpeningStock', orgId, itemId] });
      await queryClient.invalidateQueries({ queryKey: ['item', orgId, itemId] });
      toast.success('Opening stock saved');
      navigate(-1);
    },
    onError: () => toast.error('Failed to save opening stock'),
  });

  const isSaving = saveOpeningStockMutation.isPending;
  const isBatchTracked = item?.inventoryTracking === 'batch';
  const itemName = item?.name;

  const defaultSellingPrice = item?.sellingPrice !== undefined && item?.sellingPrice !== null ? String(item.sellingPrice) : '';
  const defaultMrp = item?.mrp !== undefined && item?.mrp !== null && String(item.mrp) !== '' ? String(item.mrp) : defaultSellingPrice;

  const [locationRows, setLocationRows] = useState<OpeningStockLocationRow[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  if (initialRows && item && !isInitialized) {
    setLocationRows(toFormRows(initialRows, isBatchTracked, defaultSellingPrice, defaultMrp));
    setIsInitialized(true);
  }\);

// Replace handleSave onClose call with navigate(-1) and onSave call with save mutation
content = content.replace(/      if \(onSave\) \{[\s\S]*?await onSave\(locationRows\);[\s\S]*?\}[\s\S]*?onClose\(\);/, \      await saveOpeningStockMutation.mutateAsync(locationRows);\);

// Replace Modal wrapper with full page div layout
content = content.replace(/  return \([\s\S]*?<Modal[\s\S]*?>\s*<div style=\{\{ overflowX: 'auto', minHeight: '500px' \}\}>/m, \  const dateCellStyle = (isExisting: boolean | undefined): React.CSSProperties => ({
    ...inputStyle,
    ...(isExisting ? { background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' } : {}),
  });

  return (
    <div style={{ padding: '24px', background: '#f8fafc', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: '#fff', padding: '16px 24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              background: '#f1f5f9',
              border: 'none',
              cursor: 'pointer',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px',
              borderRadius: '50%',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e2e8f0')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
          >
            <X size={20} />
          </button>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#0f172a', margin: 0 }}>{itemName || 'Opening Stock'}</h1>
            <p style={{ color: '#64748b', fontSize: '13px', marginTop: '4px', marginBottom: 0 }}>
              {isBatchTracked
                ? 'Enter location stock and batch details, then save to persist them.'
                : 'Enter location stock details, then save to persist them.'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              padding: '8px 16px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '13px',
              color: '#334155',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#fff')}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '8px 24px',
              border: 'none',
              background: isSaving ? '#93c5fd' : '#0062ff',
              color: '#fff',
              borderRadius: '6px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              fontSize: '13px',
              opacity: isSaving ? 0.85 : 1,
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => { if (!isSaving) e.currentTarget.style.backgroundColor = '#2563eb'; }}
            onMouseLeave={(e) => { if (!isSaving) e.currentTarget.style.backgroundColor = '#0062ff'; }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      
      <div style={{ overflowX: 'auto', flex: 1, background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '24px' }}>\);

// Replace closing Modal tag
content = content.replace(/    <\/Modal>/, \    </div>
    </div>\);

// Also fix the state updates that were using prevDefaultSellingPrice
content = content.replace(/  if \([\s\S]*?\) \{\n    setPrevDefaultSellingPrice\(defaultSellingPrice\);\n    setPrevDefaultMrp\(defaultMrp\);\n    setLocationRows\(\(prevRows\) =>\n      prevRows.map\(\(loc\) => \(\{\n        \.\.\.loc,\n        batches: loc.batches.map\(\(b\) => \{\n          if \(b.isExisting\) return b;\n          return \{\n            \.\.\.b,\n            sellingPrice: b.sellingPrice \|\| defaultSellingPrice,\n            mrp: b.mrp \|\| defaultMrp,\n          \};\n        \}\),\n      \}\)\),\n    \);\n  \}/m, "");

fs.writeFileSync(file, content);
