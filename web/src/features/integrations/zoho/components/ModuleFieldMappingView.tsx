import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import {
  ArrowLeft,
  HelpCircle,
  ArrowRightLeft,
  Lock,
  Save,
  RefreshCw,
  Zap,
  Info,
  X,
  Search,
  Plus,
  Trash2,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  useZohoEntityFields,
  useZohoSyncSettings,
  useSaveZohoSyncConfig,
  useInstantZohoSync,
} from '../zoho.api';
import { useActiveCustomFields } from '../../../custom-fields/customFields.api';
import type {
  ZohoSyncModuleKey,
  ZohoFieldMappingItem,
  ZohoField,
  AppFieldDefinition,
  ZohoSyncDirection,
  ZohoSyncStatus,
} from '../zoho.schemas';
import { toApiErrorMessage } from '../../../../api/client';

interface ModuleFieldMappingViewProps {
  orgId: string;
  module: ZohoSyncModuleKey;
  onBack: () => void;
}

export const ModuleFieldMappingView: React.FC<ModuleFieldMappingViewProps> = ({
  orgId,
  module,
  onBack,
}) => {
  const { data: syncSettings, refetch: refetchSettings } = useZohoSyncSettings(orgId);
  const { data: fieldsData, isLoading: isFieldsLoading } = useZohoEntityFields(orgId, module);
  const { data: clientCustomFields = [] } = useActiveCustomFields(orgId, module);

  const saveMutation = useSaveZohoSyncConfig(orgId);
  const instantSyncMutation = useInstantZohoSync(orgId);

  const [duplicationPref, setDuplicationPref] = useState('Item Name');
  const [conflictResolution, setConflictResolution] = useState('Clone');
  const [syncDirection, setSyncDirection] = useState<ZohoSyncDirection>('TWO_WAY');
  const [syncStatus, setSyncStatus] = useState<ZohoSyncStatus>('ACTIVE');
  const [syncAddresses, setSyncAddresses] = useState(true);
  const [syncContactPersons, setSyncContactPersons] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'standard' | 'custom' | 'mapped'>('all');
  const [isInstantSyncing, setIsInstantSyncing] = useState(false);

  // User-added custom field mapping definitions on the fly
  const [userAddedFields, setUserAddedFields] = useState<AppFieldDefinition[]>([]);

  // Add Custom Mapping Modal State
  const [showAddCustomModal, setShowAddCustomModal] = useState(false);
  const [newCustomLabel, setNewCustomLabel] = useState('');
  const [newCustomKey, setNewCustomKey] = useState('');
  const [newCustomZohoField, setNewCustomZohoField] = useState('');
  const [newCustomCustomZohoInput, setNewCustomCustomZohoInput] = useState('');

  // App field key -> Zoho field name mapping dictionary
  const [fieldMappingDict, setFieldMappingDict] = useState<Record<string, string>>({});

  const moduleTitles: Record<
    ZohoSyncModuleKey,
    { title: string; zohoEntityLabel: string; appEntityLabel: string }
  > = {
    item: {
      title: 'Item Sync Settings',
      zohoEntityLabel: 'Items\nZoho Books Field',
      appEntityLabel: 'Jobwork / App Fields',
    },
    customer: {
      title: 'Accounts & Customers Sync Settings',
      zohoEntityLabel: 'Customers\nZoho Books Field',
      appEntityLabel: 'Jobwork / App Fields',
    },
    vendor: {
      title: 'Vendor Sync Settings',
      zohoEntityLabel: 'Vendors\nZoho Books Field',
      appEntityLabel: 'Jobwork / App Fields',
    },
  };

  const meta = moduleTitles[module];

  // Available Zoho Fields
  const availableZohoFields: ZohoField[] = fieldsData?.zohoFields || [];
  const standardZohoFields = useMemo(() => availableZohoFields.filter((f) => !f.is_custom_field), [availableZohoFields]);
  const customZohoFields = useMemo(() => availableZohoFields.filter((f) => f.is_custom_field), [availableZohoFields]);

  // Combine backend appFields with any active client custom fields and user added fields
  const allAppFields: AppFieldDefinition[] = useMemo(() => {
    const baseFields = fieldsData?.appFields || [];
    const fieldsMap = new Map<string, AppFieldDefinition>();

    for (const bf of baseFields) {
      fieldsMap.set(bf.key, bf);
    }

    // Merge any client custom fields that might not be in base fields yet
    for (const cf of clientCustomFields) {
      const key = `customFields.${cf.key}`;
      if (!fieldsMap.has(key)) {
        const dt = String(cf.dataType || '').toLowerCase();
        fieldsMap.set(key, {
          key,
          label: cf.label,
          type: (dt === 'number' || dt === 'decimal' || dt === 'currency'
            ? 'number'
            : dt === 'checkbox' || dt === 'boolean'
              ? 'boolean'
              : 'string') as any,
          required: Boolean(cf.isRequired),
          isSystem: false,
          isCustomField: true,
          description: `Custom field: ${cf.label}`,
        });
      }
    }

    // Merge user added custom fields
    for (const uaf of userAddedFields) {
      if (!fieldsMap.has(uaf.key)) {
        fieldsMap.set(uaf.key, uaf);
      }
    }

    return Array.from(fieldsMap.values());
  }, [fieldsData?.appFields, clientCustomFields, userAddedFields]);

  // Initialize or load existing config
  useEffect(() => {
    const existingConfig = syncSettings?.modules?.[module];
    const dict: Record<string, string> = {};
    const restoredUserFields: AppFieldDefinition[] = [];

    if (existingConfig && existingConfig.fieldMappings && existingConfig.fieldMappings.length > 0) {
      setDuplicationPref(existingConfig.duplicationPreference || (module === 'item' ? 'Item Name' : 'Contact Name'));
      setConflictResolution(existingConfig.conflictResolution || 'Clone');
      setSyncDirection(existingConfig.syncDirection || 'TWO_WAY');
      setSyncStatus(existingConfig.status || 'ACTIVE');
      setSyncAddresses(existingConfig.syncAddresses !== undefined ? existingConfig.syncAddresses : true);
      setSyncContactPersons(existingConfig.syncContactPersons !== undefined ? existingConfig.syncContactPersons : true);

      for (const m of existingConfig.fieldMappings) {
        if (m.appField && m.zohoField) {
          dict[m.appField] = m.zohoField;
          if (m.appField.startsWith('customFields.')) {
            const label = m.appFieldLabel || m.appField.slice(13).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            restoredUserFields.push({
              key: m.appField,
              label,
              type: 'string',
              required: false,
              isSystem: false,
              isCustomField: true,
              description: `Custom field: ${label}`,
            });
          }
        }
      }
      if (restoredUserFields.length > 0) {
        setUserAddedFields((prev) => {
          const map = new Map(prev.map((f) => [f.key, f]));
          for (const rf of restoredUserFields) {
            if (!map.has(rf.key)) {
              map.set(rf.key, rf);
            }
          }
          return Array.from(map.values());
        });
      }
    } else if (fieldsData?.defaultMappings && fieldsData.defaultMappings.length > 0) {
      for (const dm of fieldsData.defaultMappings) {
        if (dm.appField && dm.zohoField) {
          dict[dm.appField] = dm.zohoField;
        }
      }
      setDuplicationPref(module === 'item' ? 'Item Name' : 'Contact Name');
      setConflictResolution('Clone');
      setSyncStatus('ACTIVE');
      setSyncAddresses(true);
      setSyncContactPersons(true);
    }

    // Ensure mandatory name mapping is always present
    const reqKey = module === 'item' ? 'name' : 'displayName';
    const reqZoho = module === 'item' ? 'name' : 'contact_name';
    if (!dict[reqKey]) {
      dict[reqKey] = reqZoho;
    }

    setFieldMappingDict(dict);
  }, [syncSettings, fieldsData, module]);

  const handleMappingChange = (appFieldKey: string, newZohoField: string) => {
    setFieldMappingDict((prev) => {
      const next = { ...prev };
      if (!newZohoField) {
        delete next[appFieldKey];
      } else {
        next[appFieldKey] = newZohoField;
      }
      return next;
    });
  };

  const handleSave = async () => {
    // Validate required fields
    const reqAppKey = module === 'item' ? 'name' : 'displayName';
    const reqZohoKey = module === 'item' ? 'name' : 'contact_name';

    if (!fieldMappingDict[reqAppKey]) {
      toast.error(`The required field (${reqAppKey}) must be mapped to a Zoho Books field.`);
      return;
    }

    // Convert dictionary to ZohoFieldMappingItem array
    const fieldMappingsToSave: ZohoFieldMappingItem[] = [];

    for (const appField of allAppFields) {
      const zohoFieldKey = fieldMappingDict[appField.key];
      if (zohoFieldKey) {
        const matchedZoho = availableZohoFields.find((f) => f.field_name === zohoFieldKey);
        fieldMappingsToSave.push({
          id: `map_${appField.key}`,
          zohoField: zohoFieldKey,
          zohoFieldLabel: matchedZoho?.label || zohoFieldKey,
          appField: appField.key,
          appFieldLabel: appField.label,
          isRequired: Boolean(appField.required || appField.isSystem || appField.key === reqAppKey),
          isSystem: Boolean(appField.isSystem || appField.key === reqAppKey),
          dataType: matchedZoho?.data_type || 'string',
        });
      }
    }

    // Ensure required mapping is present
    if (!fieldMappingsToSave.some((m) => m.appField === reqAppKey || m.zohoField === reqZohoKey)) {
      fieldMappingsToSave.unshift({
        id: `map_${reqAppKey}`,
        zohoField: reqZohoKey,
        zohoFieldLabel: module === 'item' ? 'Name' : 'Contact Name',
        appField: reqAppKey,
        appFieldLabel: module === 'item' ? 'Name' : 'Contact Name',
        isRequired: true,
        isSystem: true,
        dataType: 'string',
      });
    }

    try {
      await saveMutation.mutateAsync({
        module,
        syncDirection,
        duplicationPreference: duplicationPref,
        conflictResolution,
        fieldMappings: fieldMappingsToSave,
        status: syncStatus,
        syncAddresses,
        syncContactPersons,
      });
      toast.success('Sync settings and field mappings saved successfully!');
      refetchSettings();
    } catch (err) {
      toast.error(toApiErrorMessage(err));
    }
  };

  const [syncingType, setSyncingType] = useState<'incremental' | 'full' | null>(null);

  const handleSync = async (fullSync = false) => {
    setSyncingType(fullSync ? 'full' : 'incremental');
    try {
      const res = await instantSyncMutation.mutateAsync({
        module,
        fullSync,
        syncMode: fullSync ? 'full' : 'incremental',
        syncAddresses,
        syncContactPersons,
      });
      toast.success(
        res?.message ||
          `${fullSync ? 'Full sync' : 'Instant sync'} completed successfully!`,
      );
      refetchSettings();
    } catch (err) {
      toast.error(toApiErrorMessage(err));
    } finally {
      setSyncingType(null);
    }
  };

  const handleAddCustomField = () => {
    const label = newCustomLabel.trim();
    if (!label) {
      toast.error('Please enter a custom field label');
      return;
    }

    const key = newCustomKey.trim()
      ? newCustomKey.trim().startsWith('customFields.')
        ? newCustomKey.trim()
        : `customFields.${newCustomKey.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`
      : `customFields.${label.toLowerCase().replace(/[^a-zA-Z0-9_]/g, '_')}`;

    const chosenZoho = newCustomCustomZohoInput.trim() || newCustomZohoField.trim();
    if (!chosenZoho) {
      toast.error('Please select or specify a Zoho Books field to map to');
      return;
    }

    const newDef: AppFieldDefinition = {
      key,
      label,
      type: 'string',
      required: false,
      isSystem: false,
      isCustomField: true,
      description: `Custom field: ${label}`,
    };

    setUserAddedFields((prev) => [...prev.filter((f) => f.key !== key), newDef]);
    setFieldMappingDict((prev) => ({ ...prev, [key]: chosenZoho }));

    // Reset modal
    setNewCustomLabel('');
    setNewCustomKey('');
    setNewCustomZohoField('');
    setNewCustomCustomZohoInput('');
    setShowAddCustomModal(false);
    toast.success(`Custom field "${label}" added to mapping!`);
  };

  const handleRemoveCustomField = (fieldKey: string) => {
    setUserAddedFields((prev) => prev.filter((f) => f.key !== fieldKey));
    setFieldMappingDict((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
    toast.success('Custom field mapping removed');
  };

  const standardFieldsCount = useMemo(
    () => allAppFields.filter((f) => !f.isCustomField && !f.key.startsWith('customFields.')).length,
    [allAppFields],
  );
  const customFieldsCount = useMemo(
    () => allAppFields.filter((f) => f.isCustomField || f.key.startsWith('customFields.')).length,
    [allAppFields],
  );

  // Filter app fields by search query and active tab
  const filteredAppFields = useMemo(() => {
    let list = allAppFields;

    if (activeTab === 'standard') {
      list = list.filter((f) => !f.isCustomField && !f.key.startsWith('customFields.'));
    } else if (activeTab === 'custom') {
      list = list.filter((f) => f.isCustomField || f.key.startsWith('customFields.'));
    } else if (activeTab === 'mapped') {
      list = list.filter((f) => Boolean(fieldMappingDict[f.key]));
    }

    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        f.key.toLowerCase().includes(q) ||
        (f.description && f.description.toLowerCase().includes(q)),
    );
  }, [allAppFields, activeTab, searchQuery, fieldMappingDict]);

  const mappedCount = Object.keys(fieldMappingDict).length;

  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: '10px',
        border: '1px solid var(--color-border)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        overflow: 'hidden',
      }}
    >
      {/* Header matching user's Reference UI */}
      <div
        style={{
          padding: '20px 32px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              padding: '6px',
              cursor: 'pointer',
              color: '#334155',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '6px',
            }}
            title="Back to Sync Hub"
          >
            <ArrowLeft size={20} />
          </button>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--navy-900)', margin: 0 }}>
            {meta.title}
          </h2>
        </div>

        <a
          href="https://www.zoho.com/in/books/help/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            color: '#2563eb',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          <HelpCircle size={16} />
          Help
        </a>
      </div>

      <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Sync Preferences Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '720px' }}>
          {/* Preference 1: Duplication */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(280px, 360px) 1fr',
              alignItems: 'center',
              gap: '24px',
            }}
          >
            <label
              htmlFor="duplication-pref-select"
              style={{ fontSize: '14px', color: '#334155', fontWeight: 500 }}
            >
              Choose the preference for {module === 'item' ? 'Item' : module === 'customer' ? 'Customer' : 'Vendor'} duplication
            </label>
            <select
              id="duplication-pref-select"
              value={duplicationPref}
              onChange={(e) => setDuplicationPref(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '280px',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                backgroundColor: '#fff',
                color: '#111827',
                outline: 'none',
              }}
            >
              {module === 'item' ? (
                <>
                  <option value="Item Name">Item Name</option>
                  <option value="SKU">SKU</option>
                  <option value="Item Name and SKU">Item Name and SKU</option>
                </>
              ) : (
                <>
                  <option value="Contact Name">Contact Name</option>
                  <option value="Company Name">Company Name</option>
                  <option value="Email">Email</option>
                </>
              )}
            </select>
          </div>

          {/* Preference 2: Conflict resolution */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(280px, 360px) 1fr',
              alignItems: 'center',
              gap: '24px',
            }}
          >
            <label
              htmlFor="conflict-resolution-select"
              style={{ fontSize: '14px', color: '#334155', fontWeight: 500 }}
            >
              What needs to be done on Zoho Books's {module === 'item' ? 'item' : 'record'} when the same record is modified on both sides?
            </label>
            <select
              id="conflict-resolution-select"
              value={conflictResolution}
              onChange={(e) => setConflictResolution(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '280px',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                backgroundColor: '#fff',
                color: '#111827',
                outline: 'none',
              }}
            >
              <option value="Clone">Clone</option>
              <option value="Overwrite with Zoho Books">Overwrite with Zoho Books</option>
              <option value="Overwrite with App record">Overwrite with App record</option>
              <option value="Keep latest modified">Keep latest modified</option>
            </select>
          </div>

          {/* Preference 3: Sync Direction */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(280px, 360px) 1fr',
              alignItems: 'center',
              gap: '24px',
            }}
          >
            <label
              htmlFor="sync-direction-select"
              style={{ fontSize: '14px', color: '#334155', fontWeight: 500 }}
            >
              Data Sync Direction
            </label>
            <select
              id="sync-direction-select"
              value={syncDirection}
              onChange={(e) => setSyncDirection(e.target.value as ZohoSyncDirection)}
              style={{
                width: '100%',
                maxWidth: '280px',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                backgroundColor: '#fff',
                color: '#111827',
                outline: 'none',
              }}
            >
              <option value="TWO_WAY">Two-way Sync (⇄ Both Directions)</option>
              <option value="APP_TO_ZOHO">Push Only (App → Zoho Books)</option>
              <option value="ZOHO_TO_APP">Pull Only (Zoho Books → App)</option>
            </select>
          </div>

          {/* Preference 4: Sync Status */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(280px, 360px) 1fr',
              alignItems: 'center',
              gap: '24px',
            }}
          >
            <label
              htmlFor="sync-status-select"
              style={{ fontSize: '14px', color: '#334155', fontWeight: 500 }}
            >
              Sync Status
            </label>
            <select
              id="sync-status-select"
              value={syncStatus}
              onChange={(e) => setSyncStatus(e.target.value as ZohoSyncStatus)}
              style={{
                width: '100%',
                maxWidth: '280px',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                backgroundColor: '#fff',
                color: '#111827',
                outline: 'none',
              }}
            >
              <option value="ACTIVE">Active (Sync Enabled)</option>
              <option value="INACTIVE">Inactive (Sync Disabled)</option>
              <option value="PAUSED">Paused (Sync On Hold)</option>
            </select>
          </div>

          {(module === 'customer' || module === 'vendor') && (
            <>
              {/* Preference: Sync Addresses */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(280px, 360px) 1fr',
                  alignItems: 'center',
                  gap: '24px',
                }}
              >
                <div>
                  <label
                    htmlFor="sync-addresses-check"
                    style={{ fontSize: '14px', color: '#334155', fontWeight: 500, display: 'block' }}
                  >
                    Sync Addresses
                  </label>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    Sync billing & shipping addresses into {module === 'customer' ? 'Customer' : 'Vendor'} address directory
                  </span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    id="sync-addresses-check"
                    type="checkbox"
                    checked={syncAddresses}
                    onChange={(e) => setSyncAddresses(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--navy-600, #2563eb)' }}
                  />
                  <span style={{ fontSize: '14px', color: '#1e293b' }}>
                    {syncAddresses ? 'Enabled (Sync addresses)' : 'Disabled (Do not sync addresses)'}
                  </span>
                </label>
              </div>

              {/* Preference: Sync Contact Persons */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(280px, 360px) 1fr',
                  alignItems: 'center',
                  gap: '24px',
                }}
              >
                <div>
                  <label
                    htmlFor="sync-contact-persons-check"
                    style={{ fontSize: '14px', color: '#334155', fontWeight: 500, display: 'block' }}
                  >
                    Sync Contact Persons
                  </label>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    Sync primary and additional contact persons into contact persons directory
                  </span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    id="sync-contact-persons-check"
                    type="checkbox"
                    checked={syncContactPersons}
                    onChange={(e) => setSyncContactPersons(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--navy-600, #2563eb)' }}
                  />
                  <span style={{ fontSize: '14px', color: '#1e293b' }}>
                    {syncContactPersons ? 'Enabled (Sync contact persons)' : 'Disabled (Do not sync contact persons)'}
                  </span>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Map Fields Section matching Screenshot 4 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--navy-900)', margin: 0 }}>
                Map Fields
              </h3>
              <span
                style={{
                  fontSize: '12px',
                  padding: '3px 8px',
                  borderRadius: '12px',
                  backgroundColor: '#f1f5f9',
                  color: '#475569',
                  fontWeight: 500,
                }}
              >
                {mappedCount} of {allAppFields.length} fields mapped
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {/* Filter Tabs */}
              <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f1f5f9', padding: '3px', borderRadius: '8px', gap: '2px' }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('all')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: activeTab === 'all' ? '#fff' : 'transparent',
                    color: activeTab === 'all' ? '#0f172a' : '#64748b',
                    boxShadow: activeTab === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  }}
                >
                  All ({allAppFields.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('standard')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: activeTab === 'standard' ? '#fff' : 'transparent',
                    color: activeTab === 'standard' ? '#0f172a' : '#64748b',
                    boxShadow: activeTab === 'standard' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  }}
                >
                  Standard ({standardFieldsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('custom')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: activeTab === 'custom' ? '#fff' : 'transparent',
                    color: activeTab === 'custom' ? '#2563eb' : '#64748b',
                    boxShadow: activeTab === 'custom' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  }}
                >
                  Custom Fields ({customFieldsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('mapped')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: activeTab === 'mapped' ? '#fff' : 'transparent',
                    color: activeTab === 'mapped' ? '#059669' : '#64748b',
                    boxShadow: activeTab === 'mapped' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  }}
                >
                  Mapped ({mappedCount})
                </button>
              </div>

              {/* Quick search filter */}
              <div style={{ position: 'relative', width: '200px' }}>
                <Search
                  size={14}
                  style={{
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#94a3b8',
                  }}
                />
                <input
                  type="text"
                  placeholder="Search fields..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 12px 6px 30px',
                    fontSize: '13px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    outline: 'none',
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      padding: 0,
                      display: 'flex',
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Add Custom Field Mapping Button */}
              <button
                type="button"
                onClick={() => setShowAddCustomModal(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#2563eb',
                  backgroundColor: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                <Plus size={15} />
                Add Custom Mapping
              </button>
            </div>
          </div>

          {/* Field Mapping Table Layout */}
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              overflow: 'hidden',
              backgroundColor: '#fff',
            }}
          >
            {/* Table Column Headers matching user's requirements: Jobwork Field left, Zoho Field right */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(240px, 1fr) 50px minmax(280px, 1fr)',
                alignItems: 'center',
                padding: '14px 24px',
                backgroundColor: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                fontSize: '13px',
                fontWeight: 600,
                color: '#475569',
              }}
            >
              <div>
                <div style={{ color: 'var(--navy-900)', fontWeight: 600 }}>
                  {module === 'item' ? 'Item' : module === 'customer' ? 'Customer' : 'Vendor'} Fields
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 400 }}>
                  Jobwork Project Field (Fixed)
                </div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <ArrowRightLeft size={16} color="#94a3b8" />
              </div>

              <div>
                <div style={{ color: 'var(--navy-900)', fontWeight: 600 }}>
                  Zoho Books Field
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 400 }}>
                  Select Zoho Field to Map
                </div>
              </div>
            </div>

            {/* Field Rows */}
            {isFieldsLoading ? (
              <div
                style={{
                  padding: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  color: '#64748b',
                  fontSize: '14px',
                }}
              >
                <RefreshCw size={16} className="animate-spin" />
                Loading available fields from Zoho Books API...
              </div>
            ) : filteredAppFields.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
                No fields match your search "{searchQuery}".
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {filteredAppFields.map((field, index) => {
                  const reqKey = module === 'item' ? 'name' : 'displayName';
                  const isMandatorySystem = field.key === reqKey || Boolean(field.isSystem);
                  const currentMappedZoho = fieldMappingDict[field.key] || '';
                  const isUserCustomField = Boolean(field.isCustomField || field.key.startsWith('customFields.'));

                  return (
                    <div
                      key={field.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(240px, 1fr) 50px minmax(280px, 1fr)',
                        alignItems: 'center',
                        padding: '14px 24px',
                        borderBottom: index < filteredAppFields.length - 1 ? '1px solid #f1f5f9' : 'none',
                        backgroundColor: isMandatorySystem ? '#fafafa' : '#fff',
                      }}
                    >
                      {/* Left Side: Fixed Jobwork Project Field */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14px', fontWeight: 500, color: '#1e293b' }}>
                          {field.label}
                        </span>
                        {field.required && (
                          <span style={{ color: '#dc2626', fontWeight: 700, marginLeft: '-4px' }}>*</span>
                        )}
                        {isMandatorySystem && (
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: '#f1f5f9',
                              color: '#64748b',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                            title="Required system field"
                          >
                            <Lock size={10} /> System Required
                          </span>
                        )}
                        {isUserCustomField && (
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: '#eff6ff',
                              color: '#2563eb',
                              fontWeight: 500,
                            }}
                          >
                            Custom Field
                          </span>
                        )}
                      </div>

                      {/* Middle: Mapping Connector Arrow */}
                      <div style={{ textAlign: 'center', color: currentMappedZoho ? '#2563eb' : '#cbd5e1' }}>
                        <ArrowRightLeft size={16} />
                      </div>

                      {/* Right Side: Zoho Field Dropdown and Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '340px' }}>
                        <select
                          value={currentMappedZoho}
                          onChange={(e) => handleMappingChange(field.key, e.target.value)}
                          disabled={isMandatorySystem}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            fontSize: '14px',
                            border: currentMappedZoho ? '1px solid #93c5fd' : '1px solid #d1d5db',
                            borderRadius: '6px',
                            backgroundColor: isMandatorySystem ? '#f1f5f9' : '#fff',
                            color: currentMappedZoho ? '#1e293b' : '#9ca3af',
                            cursor: isMandatorySystem ? 'not-allowed' : 'pointer',
                            outline: 'none',
                          }}
                        >
                          <option value="">(None / Not Mapped)</option>
                          {standardZohoFields.length > 0 && (
                            <optgroup label="Standard Zoho Fields">
                              {standardZohoFields.map((zf) => (
                                <option key={zf.field_name} value={zf.field_name}>
                                  {zf.label} {zf.is_mandatory ? '*' : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {customZohoFields.length > 0 && (
                            <optgroup label="Zoho Custom Fields">
                              {customZohoFields.map((zf) => (
                                <option key={zf.field_name} value={zf.field_name}>
                                  {zf.label} (Custom)
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>

                        {currentMappedZoho && !isMandatorySystem && (
                          <button
                            type="button"
                            onClick={() => handleMappingChange(field.key, '')}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: '6px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Clear mapping"
                          >
                            <X size={16} />
                          </button>
                        )}

                        {isUserCustomField && !isMandatorySystem && (
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomField(field.key)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '6px',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Delete custom field mapping"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Live Field API Notice */}
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '13px',
            color: '#475569',
          }}
        >
          <Info size={16} color="#2563eb" style={{ flexShrink: 0 }} />
          <span>
            Fields on the left side represent all standard and custom fields configured in your Jobwork project. Select the corresponding Zoho Books field on the right side to synchronize data seamlessly.
          </span>
        </div>

        {/* Bottom Actions Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '16px',
            borderTop: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending}
              style={{
                padding: '10px 24px',
                backgroundColor: 'var(--navy-900)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: saveMutation.isPending ? 'not-allowed' : 'pointer',
                opacity: saveMutation.isPending ? 0.7 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Save size={16} />
              {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
            </button>

            <button
              type="button"
              onClick={onBack}
              style={{
                padding: '10px 18px',
                backgroundColor: '#fff',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Incremental Instant Sync */}
            <button
              type="button"
              onClick={() => handleSync(false)}
              disabled={Boolean(syncingType)}
              title="Sync new or modified records since last sync time"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '10px 18px',
                backgroundColor: '#15803d',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: syncingType ? 'not-allowed' : 'pointer',
                opacity: syncingType === 'incremental' ? 0.7 : 1,
              }}
            >
              {syncingType === 'incremental' ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <Zap size={15} />
                  Instant Sync
                </>
              )}
            </button>

            {/* Full Sync All Records (Not based on time) */}
            <button
              type="button"
              onClick={() => handleSync(true)}
              disabled={Boolean(syncingType)}
              title="Sync all records from Zoho Books from scratch without time filtering"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '10px 18px',
                backgroundColor: '#4338ca',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: syncingType ? 'not-allowed' : 'pointer',
                opacity: syncingType === 'full' ? 0.7 : 1,
              }}
            >
              {syncingType === 'full' ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  Full Syncing...
                </>
              ) : (
                <>
                  <RefreshCw size={15} />
                  Sync All Records (Full Sync)
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Add Custom Field Mapping Modal */}
      {showAddCustomModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              maxWidth: '520px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              overflow: 'hidden',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: '#eff6ff',
                    color: '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Sparkles size={18} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>
                    Add Custom Field Mapping
                  </h4>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                    Map an application custom field to a Zoho Books field
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCustomModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Field Label Input */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#334155', marginBottom: '6px' }}>
                  Custom Field Label <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Batch Number, BIN Location, Vendor Rating"
                  value={newCustomLabel}
                  onChange={(e) => {
                    setNewCustomLabel(e.target.value);
                    if (!newCustomKey || newCustomKey.startsWith('customFields.')) {
                      const slug = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_');
                      setNewCustomKey(`customFields.${slug}`);
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '14px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Field Key Input */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#334155', marginBottom: '6px' }}>
                  Custom Field Key
                </label>
                <input
                  type="text"
                  placeholder="customFields.field_name"
                  value={newCustomKey}
                  onChange={(e) => setNewCustomKey(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: '#f8fafc',
                    color: '#475569',
                    outline: 'none',
                  }}
                />
                <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
                  Stored under the entity's custom fields attribute.
                </span>
              </div>

              {/* Zoho Field Select */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#334155', marginBottom: '6px' }}>
                  Map to Zoho Books Field <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  value={newCustomZohoField}
                  onChange={(e) => setNewCustomZohoField(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '14px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    outline: 'none',
                    backgroundColor: '#fff',
                    marginBottom: '8px',
                  }}
                >
                  <option value="">-- Select Zoho Field --</option>
                  {customZohoFields.length > 0 && (
                    <optgroup label="Zoho Custom Fields">
                      {customZohoFields.map((zf) => (
                        <option key={zf.field_name} value={zf.field_name}>
                          {zf.label} (Custom - {zf.field_name})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {standardZohoFields.length > 0 && (
                    <optgroup label="Standard Zoho Fields">
                      {standardZohoFields.map((zf) => (
                        <option key={zf.field_name} value={zf.field_name}>
                          {zf.label} ({zf.field_name})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {/* Or Custom Zoho API Name input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>Or enter custom Zoho key:</span>
                  <input
                    type="text"
                    placeholder="e.g. cf_batch_no"
                    value={newCustomCustomZohoInput}
                    onChange={(e) => setNewCustomCustomZohoInput(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '10px',
                padding: '14px 20px',
                borderTop: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
              }}
            >
              <button
                type="button"
                onClick={() => setShowAddCustomModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#fff',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddCustomField}
                style={{
                  padding: '8px 18px',
                  backgroundColor: 'var(--navy-900)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Plus size={15} />
                Add Mapping
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

