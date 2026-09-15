interface ItemToleranceFieldProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  error?: string;
}

/**
 * The item's default over-issue allowance (landed-cost plan D10). Copied onto a job
 * order's input row when this item is picked there, so changing it later never
 * loosens an order that is already running. Blank is "no default"; 0 is "none
 * allowed".
 */
export function ItemToleranceField({ value, onChange, error }: ItemToleranceFieldProps) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}
    >
      <label
        htmlFor="item-default-tolerance"
        style={{ fontSize: 13, color: '#4b5563', fontWeight: 500, whiteSpace: 'nowrap' }}
      >
        Tolerance %
      </label>
      <div>
        <input
          id="item-default-tolerance"
          type="number"
          step="0.001"
          min="0"
          max="100"
          value={value ?? ''}
          // Its own handler: the page's shared one turns 0 into null, and 0 here
          // means "no over-issue allowed", not "no default".
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          onWheel={(e) => e.currentTarget.blur()}
          placeholder="No default"
          title="How far over the plan a job order may issue this item. Copied onto each job order when the item is picked."
          style={{
            width: '140px',
            padding: '8px 12px',
            borderRadius: '4px',
            border: error ? '1px solid #ef4444' : '1px solid #d1d5db',
            fontSize: 13,
          }}
        />
        {error && (
          <span style={{ color: '#ef4444', fontSize: 12, marginTop: 4, display: 'block' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
