$file = 'e:\octfis-project\jobwork-process-webapp\web\src\features\items\OpeningStockPage.tsx'
$content = Get-Content $file -Raw

# Replace imports
$content = $content -replace "import \{ Modal \} from '../../../components/ui/Modal';", "import { useNavigate, useParams } from 'react-router-dom';"
$content = $content -replace "import \{ useQuery \} from '@tanstack/react-query';", "import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';"

# Replace interface and function signature
$content = $content -replace "(?s)export interface OpeningStockLocationRow.*?export function AddOpeningStockModal\([^)]+\) \{", "export interface OpeningStockLocationRow {
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

export function OpeningStockPage() {"

# Replace setup block
$content = $content -replace "(?s)  const isBatchTracked = inventoryTracking === 'batch';.*?const \[prevDefaultMrp, setPrevDefaultMrp\] = useState\(defaultMrp\);", "  const { orgId, id: itemId } = useParams<{ orgId: string; id: string }>();
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
  }"

# Replace onSave with save mutation
$content = $content -replace "(?s)      if \(onSave\) \{.*?await onSave\(locationRows\);.*?\}[\s\S]*?onClose\(\);", "      await saveOpeningStockMutation.mutateAsync(locationRows);"

# Replace return Modal with return div
$content = $content -replace "(?s)  return \([\s\S]*?<Modal[\s\S]*?>\s*<div style=\{\{ overflowX: 'auto', minHeight: '500px' \}\}>", "  const dateCellStyle = (isExisting: boolean | undefined): React.CSSProperties => ({
    ...inputStyle,
    ...(isExisting ? { background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' } : {}),
  });

  return (
    <div style={{ padding: '24px', background: '#f8fafc', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: '#fff', padding: '16px 24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type=\"button\"
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
            type=\"button\"
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
            }}
          >
            Cancel
          </button>
          <button
            type=\"button\"
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
            }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      
      <div style={{ overflowX: 'auto', flex: 1, background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '24px' }}>"

$content = $content -replace "    </Modal>", "    </div>
    </div>"

# Clean up prevDefaultSellingPrice state updates
$content = $content -replace "(?s)  if \([\s\S]*?\) \{\n    setPrevDefaultSellingPrice\(defaultSellingPrice\);\n    setPrevDefaultMrp\(defaultMrp\);\n    setLocationRows\(\(prevRows\) =>\n      prevRows.map\(\(loc\) => \(\{\n        \.\.\.loc,\n        batches: loc.batches.map\(\(b\) => \{\n          if \(b.isExisting\) return b;\n          return \{\n            \.\.\.b,\n            sellingPrice: b.sellingPrice \|\| defaultSellingPrice,\n            mrp: b.mrp \|\| defaultMrp,\n          \};\n        \}\),\n      \}\)\),\n    \);\n  \}", """

Set-Content $file -Value $content
