import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HelpCircle } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { RadioGroup } from '../../../components/ui/RadioGroup';
import {
  MultiSelectChips,
  type MultiSelectChipOption,
} from '../../../components/ui/MultiSelectChips';
import { useTrackingLabel, useBatchUnitLabel } from '../../../hooks/useTrackingLabel';
import { itemsApi } from '../items.api';
import type { Item, ItemBatchDto } from '../items.schemas';
import { generateBarcodePdfBlob, type BarcodeLabelData } from '../utils/barcodeGenerator';

export interface PrintBarcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  itemId: string;
  item?: Item;
  onPrintSuccess?: (pdfUrl: string) => void;
  // Backward compatibility props if needed
  config?: {
    template?: string;
    generationField?: string;
    displayDefaultPrice?: string;
  };
  onEdit?: () => void;
  onPrint?: (copies: number) => void;
  isPrinting?: boolean;
}

export const PrintBarcodeModal: React.FC<PrintBarcodeModalProps> = ({
  isOpen,
  onClose,
  orgId,
  itemId,
  item,
  onPrintSuccess,
  config,
  onPrint,
  isPrinting = false,
}) => {
  const { singular: batchSingular, plural: batchPlural } = useTrackingLabel();
  const { singular: unitSingular, plural: unitPlural } = useBatchUnitLabel();

  const isBatchTracked = Boolean(
    item?.trackInventory !== false &&
    String(item?.inventoryTracking ?? '').toLowerCase() === 'batch',
  );

  const [generationField, setGenerationField] = useState(
    config?.generationField || (isBatchTracked ? 'batch_number' : 'item_name'),
  );
  const [displayDefaultPrice, setDisplayDefaultPrice] = useState('true');
  const [copies, setCopies] = useState<number | string>(1);
  const [labelSizePreset, setLabelSizePreset] = useState('50x30');
  const [labelWidth, setLabelWidth] = useState<number | string>(50);
  const [labelHeight, setLabelHeight] = useState<number | string>(30);

  // Multi-selection states for Batches and Takas
  const [selectedBatchKeys, setSelectedBatchKeys] = useState<string[]>([]);
  const [selectedTakaIds, setSelectedTakaIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const getBatchKey = (b: ItemBatchDto) => b.id || b.batchReference || '';

  const handleLabelSizePresetChange = (preset: string) => {
    setLabelSizePreset(preset);
    if (preset === '50x30') {
      setLabelWidth(50);
      setLabelHeight(30);
    } else if (preset === '50x25') {
      setLabelWidth(50);
      setLabelHeight(25);
    } else if (preset === '40x25') {
      setLabelWidth(40);
      setLabelHeight(25);
    } else if (preset === '40x20') {
      setLabelWidth(40);
      setLabelHeight(20);
    } else if (preset === '60x40') {
      setLabelWidth(60);
      setLabelHeight(40);
    } else if (preset === '100x50') {
      setLabelWidth(100);
      setLabelHeight(50);
    }
  };

  // Fetch batches for this item only if batch tracked
  const { data: itemBatches = [], isLoading: isBatchesLoading } = useQuery<ItemBatchDto[]>({
    queryKey: ['itemBatches', orgId, itemId],
    queryFn: () => itemsApi.getItemBatches(orgId, itemId),
    enabled: isOpen && Boolean(orgId && itemId) && isBatchTracked,
  });

  // Reset & initialize state when modal opens
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setGenerationField(
        config?.generationField || (isBatchTracked ? 'batch_number' : 'item_name'),
      );
      setDisplayDefaultPrice(config?.displayDefaultPrice || 'true');
      setCopies(1);
      setError(null);
      setSelectedBatchKeys([]);
      setSelectedTakaIds([]);
    }
  }

  // Synchronize when batches finish loading after modal is already open
  const [prevBatchesLength, setPrevBatchesLength] = useState(0);
  if (itemBatches.length !== prevBatchesLength) {
    setPrevBatchesLength(itemBatches.length);
  }

  // Batch options for MultiSelectChips
  const batchOptions: MultiSelectChipOption[] = itemBatches.map((b) => {
    const key = getBatchKey(b);
    const ref = b.batchReference || b.manufacturerBatch || 'Batch';
    const loc = b.locationName ? `(${b.locationName})` : '';
    const takaCount = (b.units || []).length;
    return {
      value: key,
      label: ref,
      subLabel: loc,
      badge:
        generationField === 'taka_number' ? `${takaCount} ${unitPlural.toLowerCase()}` : undefined,
    };
  });

  // Taka options for MultiSelectChips (across selected batches)
  const selectedBatches = itemBatches.filter((b) => selectedBatchKeys.includes(getBatchKey(b)));
  const takaOptions: MultiSelectChipOption[] = selectedBatches.flatMap((b) => {
    const batchRef = b.batchReference || b.manufacturerBatch || '';
    return (b.units || []).map((u) => ({
      value: u.batchUnitId,
      label: u.label,
      subLabel: batchRef
        ? `${batchSingular}: ${batchRef} | Qty: ${u.availableQty}`
        : `Qty: ${u.availableQty}`,
    }));
  });

  const handleBatchKeysChange = (newBatchKeys: string[]) => {
    setSelectedBatchKeys(newBatchKeys);
    setError(null);
    if (generationField === 'taka_number') {
      const activeB = itemBatches.filter((b) => newBatchKeys.includes(getBatchKey(b)));
      const validTakaIds = activeB.flatMap((b) => (b.units || []).map((u) => u.batchUnitId));
      setSelectedTakaIds((prev) => prev.filter((id) => validTakaIds.includes(id)));
    }
  };

  const handleTakaIdsChange = (newTakaIds: string[]) => {
    setSelectedTakaIds(newTakaIds);
    setError(null);
  };

  const numCopies = Math.max(1, Number(copies) || 1);

  // Calculate total labels for display
  const totalLabels =
    generationField === 'taka_number'
      ? selectedTakaIds.length * numCopies
      : generationField === 'batch_number'
        ? selectedBatchKeys.length * numCopies
        : numCopies;

  const handlePrintSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const count = Number(copies);
    if (!copies || isNaN(count) || count < 1) {
      setError('Please enter a valid number of copies (at least 1)');
      return;
    }

    if (generationField === 'batch_number') {
      if (selectedBatchKeys.length === 0) {
        setError(`Please select at least one ${batchSingular.toLowerCase()}`);
        return;
      }
    } else if (generationField === 'taka_number') {
      if (selectedBatchKeys.length === 0) {
        setError(`Please select at least one ${batchSingular.toLowerCase()}`);
        return;
      }
      if (selectedTakaIds.length === 0) {
        setError(`Please select at least one ${unitSingular.toLowerCase()}`);
        return;
      }
    }

    setError(null);

    // Build label items
    const labels: BarcodeLabelData[] = [];
    const showPrice = displayDefaultPrice === 'true';

    if (generationField === 'taka_number') {
      for (const batch of selectedBatches) {
        const batchRef = batch.batchReference || batch.manufacturerBatch || '';
        const selectedUnits = (batch.units || []).filter((u) =>
          selectedTakaIds.includes(u.batchUnitId),
        );
        for (const unit of selectedUnits) {
          const takaLabel = unit.label || 'TAKA-01';
          const barcodeVal = batchRef ? `${batchRef}/${takaLabel}` : takaLabel;
          labels.push({
            itemName: item?.name || 'Item',
            barcodeValue: barcodeVal,
            secondaryText: batchRef
              ? `${batchSingular}: ${batchRef} | ${unitSingular}: ${takaLabel}`
              : `${unitSingular}: ${takaLabel}`,
            price: showPrice ? batch.sellingPrice || item?.sellingPrice : undefined,
            copies: count,
          });
        }
      }
    } else if (generationField === 'batch_number') {
      for (const batch of selectedBatches) {
        const batchRef = batch.batchReference || batch.manufacturerBatch || 'BATCH-01';
        labels.push({
          itemName: item?.name || 'Item',
          barcodeValue: batchRef,
          secondaryText: `${batchSingular}: ${batchRef}`,
          price: showPrice ? batch.sellingPrice || item?.sellingPrice : undefined,
          copies: count,
        });
      }
    } else if (generationField === 'sku') {
      const skuVal = item?.sku || item?.name || 'SKU-01';
      labels.push({
        itemName: item?.name || 'Item',
        barcodeValue: skuVal,
        secondaryText: item?.sku ? `SKU: ${item.sku}` : undefined,
        price: showPrice ? item?.sellingPrice : undefined,
        copies: count,
      });
    } else {
      // Default: item_name
      labels.push({
        itemName: item?.name || 'Item',
        barcodeValue: item?.name || 'ITEM-01',
        price: showPrice ? item?.sellingPrice : undefined,
        copies: count,
      });
    }

    try {
      const blob = generateBarcodePdfBlob({
        labels,
        labelWidth: Number(labelWidth) || 50,
        labelHeight: Number(labelHeight) || 30,
      });
      const url = URL.createObjectURL(blob);
      if (onPrintSuccess) {
        onPrintSuccess(url);
      } else if (onPrint) {
        onPrint(count);
      }
    } catch (err) {
      console.error('Failed to generate barcode PDF:', err);
      setError('Failed to generate barcode PDF. Please try again.');
    }
  };

  const footer = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          disabled={isPrinting}
          onClick={handlePrintSubmit}
          style={{
            padding: '8px 22px',
            backgroundColor: isPrinting ? '#64748b' : '#186337',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            cursor: isPrinting ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!isPrinting) e.currentTarget.style.backgroundColor = '#13532e';
          }}
          onMouseLeave={(e) => {
            if (!isPrinting) e.currentTarget.style.backgroundColor = '#186337';
          }}
        >
          {isPrinting ? 'Printing…' : 'Print'}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '8px 20px',
            backgroundColor: '#ffffff',
            color: '#334155',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
        >
          Cancel
        </button>
      </div>

      <div style={{ fontSize: 13, color: '#64748b' }}>
        Number of Copies:{' '}
        <strong style={{ color: '#1e293b', fontWeight: 600 }}>{totalLabels}</strong>
        {totalLabels > 0 && numCopies > 1 && (
          <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>
            (
            {generationField === 'taka_number'
              ? `${selectedTakaIds.length} ${unitPlural.toLowerCase()}`
              : generationField === 'batch_number'
                ? `${selectedBatchKeys.length} ${batchPlural.toLowerCase()}`
                : '1 item'}{' '}
            × {numCopies} copies)
          </span>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Print Barcode"
      width={640}
      position="top"
      footer={footer}
    >
      <form
        onSubmit={handlePrintSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '2px 4px 2px 4px',
        }}
      >
        {/* Template Field (Fixed as Barcode Template) */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <div style={{ width: 190, flexShrink: 0 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>Template</label>
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                width: '100%',
                padding: '5px 10px',
                backgroundColor: '#f8fafc',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                userSelect: 'none',
                minHeight: 32,
                boxSizing: 'border-box',
              }}
            >
              <span>Barcode Template</span>
            </div>
          </div>
        </div>

        {/* Label Size (Preset & Dimensions) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <div style={{ width: 190, flexShrink: 0 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>Label Size</label>
            </div>
            <div style={{ flex: 1 }}>
              <Select
                value={labelSizePreset}
                onChange={handleLabelSizePresetChange}
                portal={true}
                options={[
                  { label: '50 mm × 30 mm (Standard)', value: '50x30' },
                  { label: '50 mm × 25 mm (Compact)', value: '50x25' },
                  { label: '40 mm × 25 mm', value: '40x25' },
                  { label: '40 mm × 20 mm (Mini)', value: '40x20' },
                  { label: '60 mm × 40 mm (Medium)', value: '60x40' },
                  { label: '100 mm × 50 mm (Shipping / Large)', value: '100x50' },
                  { label: 'Custom Dimensions (mm)', value: 'custom' },
                ]}
              />
            </div>
          </div>

          {/* Width & Height Dimensions */}
          <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <div style={{ width: 190, flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>Dimensions (W × H mm)</span>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>Width:</span>
                <input
                  type="number"
                  min={25}
                  max={200}
                  value={labelWidth}
                  onChange={(e) => {
                    setLabelWidth(e.target.value);
                    setLabelSizePreset('custom');
                  }}
                  style={{
                    width: 65,
                    padding: '4px 6px',
                    border: '1px solid #cbd5e1',
                    borderRadius: 4,
                    fontSize: 12,
                    outline: 'none',
                    height: 28,
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ fontSize: 12, color: '#64748b' }}>mm</span>
              </div>
              <span style={{ color: '#94a3b8' }}>×</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>Height:</span>
                <input
                  type="number"
                  min={15}
                  max={200}
                  value={labelHeight}
                  onChange={(e) => {
                    setLabelHeight(e.target.value);
                    setLabelSizePreset('custom');
                  }}
                  style={{
                    width: 65,
                    padding: '4px 6px',
                    border: '1px solid #cbd5e1',
                    borderRadius: 4,
                    fontSize: 12,
                    outline: 'none',
                    height: 28,
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ fontSize: 12, color: '#64748b' }}>mm</span>
              </div>
            </div>
          </div>
        </div>

        {/* Barcode Generation Field */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <div style={{ width: 190, flexShrink: 0 }}>
            <label
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: '#334155',
                borderBottom: '1px dashed #94a3b8',
                paddingBottom: 2,
                cursor: 'help',
                display: 'inline-block',
              }}
              title="Field used to generate the barcode"
            >
              Barcode Generation Field
            </label>
          </div>
          <div style={{ flex: 1 }}>
            <Select
              value={generationField}
              onChange={(val) => {
                setGenerationField(val);
                setError(null);
                setSelectedTakaIds([]);
              }}
              portal={true}
              options={
                isBatchTracked
                  ? [
                      { label: 'Item Name', value: 'item_name' },
                      { label: `${batchSingular} Number`, value: 'batch_number' },
                      { label: `${unitSingular} Number`, value: 'taka_number' },
                      { label: 'SKU', value: 'sku' },
                    ]
                  : [
                      { label: 'Item Name', value: 'item_name' },
                      { label: 'SKU', value: 'sku' },
                    ]
              }
            />
          </div>
        </div>

        {/* Price to Display */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <div
            style={{
              width: 190,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <label style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>
              Price to Display
            </label>
            <HelpCircle size={15} style={{ color: '#94a3b8', cursor: 'pointer' }} />
          </div>
          <div style={{ flex: 1 }}>
            <RadioGroup
              name="printBarcodePrice"
              value={displayDefaultPrice}
              onChange={setDisplayDefaultPrice}
              ariaLabel="Price to Display"
              options={[
                { label: 'Default Price', value: 'true' },
                { label: 'Do not display price', value: 'false' },
              ]}
            />
          </div>
        </div>

        {/* Number of Barcode Copies */}
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <div style={{ width: 190, flexShrink: 0 }}>
            <label
              htmlFor="barcode-copies-input"
              style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}
            >
              Number of Barcode Copies
            </label>
          </div>
          <div style={{ flex: 1 }}>
            <input
              id="barcode-copies-input"
              type="number"
              min={1}
              value={copies}
              onChange={(e) => {
                setCopies(e.target.value);
                if (error) setError(null);
              }}
              style={{
                width: 120,
                padding: '5px 10px',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                fontSize: 13,
                outline: 'none',
                height: 32,
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* MULTI-BATCH SELECTION WITH TAG CHIPS (When batch_number is selected) */}
        {generationField === 'batch_number' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
            <div style={{ width: 190, flexShrink: 0, paddingTop: 4 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>
                Select {batchPlural}
              </label>
            </div>
            <div style={{ flex: 1 }}>
              {isBatchesLoading ? (
                <div style={{ fontSize: 13, color: '#64748b', padding: '6px 0' }}>
                  Loading {batchPlural.toLowerCase()}…
                </div>
              ) : batchOptions.length === 0 ? (
                <div
                  style={{ fontSize: 13, color: '#dc2626', fontStyle: 'italic', padding: '6px 0' }}
                >
                  No {batchPlural.toLowerCase()} available for this item.
                </div>
              ) : (
                <MultiSelectChips
                  options={batchOptions}
                  values={selectedBatchKeys}
                  onChange={handleBatchKeysChange}
                  placeholder={`Select ${batchPlural}...`}
                  searchPlaceholder="Search"
                  portal={true}
                />
              )}
            </div>
          </div>
        )}

        {/* MULTI-BATCH & MULTI-TAKA SELECTION WITH TAG CHIPS (When taka_number is selected) */}
        {generationField === 'taka_number' && (
          <>
            {/* Step 1: Select Batches */}
            <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
              <div style={{ width: 190, flexShrink: 0, paddingTop: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>
                  Select {batchPlural}
                </label>
              </div>
              <div style={{ flex: 1 }}>
                {isBatchesLoading ? (
                  <div style={{ fontSize: 13, color: '#64748b', padding: '6px 0' }}>
                    Loading {batchPlural.toLowerCase()}…
                  </div>
                ) : batchOptions.length === 0 ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: '#dc2626',
                      fontStyle: 'italic',
                      padding: '6px 0',
                    }}
                  >
                    No {batchPlural.toLowerCase()} available for this item.
                  </div>
                ) : (
                  <MultiSelectChips
                    options={batchOptions}
                    values={selectedBatchKeys}
                    onChange={(newKeys) => {
                      setSelectedBatchKeys(newKeys);
                      setError(null);
                      const activeB = itemBatches.filter((b) => newKeys.includes(getBatchKey(b)));
                      const validIds = new Set(
                        activeB.flatMap((b) => (b.units || []).map((u) => u.batchUnitId)),
                      );
                      setSelectedTakaIds((prev) => prev.filter((id) => validIds.has(id)));
                    }}
                    placeholder={`Select ${batchPlural}...`}
                    searchPlaceholder="Search"
                    portal={true}
                  />
                )}
              </div>
            </div>

            {/* Step 2: Select Takas across selected batches */}
            <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
              <div style={{ width: 190, flexShrink: 0, paddingTop: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>
                  Select {unitPlural}
                </label>
              </div>
              <div style={{ flex: 1 }}>
                {selectedBatchKeys.length === 0 ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: '#94a3b8',
                      fontStyle: 'italic',
                      padding: '6px 0',
                    }}
                  >
                    Please select at least one {batchSingular.toLowerCase()} first to view its{' '}
                    {unitPlural.toLowerCase()}.
                  </div>
                ) : takaOptions.length === 0 ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: '#64748b',
                      fontStyle: 'italic',
                      padding: '6px 0',
                    }}
                  >
                    No {unitPlural.toLowerCase()} recorded in the selected{' '}
                    {batchPlural.toLowerCase()}.
                  </div>
                ) : (
                  <MultiSelectChips
                    options={takaOptions}
                    values={selectedTakaIds}
                    onChange={handleTakaIdsChange}
                    placeholder={`Select ${unitPlural}...`}
                    searchPlaceholder="Search"
                    portal={true}
                  />
                )}
              </div>
            </div>
          </>
        )}

        {/* Error message */}
        {error && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#fef2f2',
              color: '#dc2626',
              borderRadius: 4,
              fontSize: 13,
              border: '1px solid #fecaca',
            }}
          >
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
};
