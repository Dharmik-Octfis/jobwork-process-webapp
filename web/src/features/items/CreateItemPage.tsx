import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Package } from 'lucide-react';
import { itemsApi } from './items.api.ts';
import type { ItemFormData } from './items.schemas.ts';
import { itemFormSchema } from './items.schemas.ts';
import { z } from 'zod';

export function CreateItemPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<ItemFormData>({
    name: '',
    aliasName: '',
    type: 'Goods',
    category: '',
    brand: '',
    manufacturer: '',
    hsnCode: '',
    taxPreference: 'Taxable',
    itemType: 'Single Item',
    unit: '',
    sku: '',
    isSalesInfo: false,
    sellingPrice: null,
    salesAccount: '',
    isPurchaseInfo: false,
    costPrice: null,
    purchaseAccount: '',
    packaging: '',
    deliveryDate: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: (data: ItemFormData) => itemsApi.createItem(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      navigate(`/organizations/${orgId}/items`);
    },
    onError: (error) => {
      console.error('Failed to create item:', error);
      alert('Failed to create item.');
    }
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : type === 'number' ? parseFloat(value) || null : value;
    
    setFormData(prev => ({
      ...prev,
      [name]: val
    }));
    
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleRadioChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      itemFormSchema.parse(formData);
      setErrors({});
      createMutation.mutate(formData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors: Record<string, string> = {};
        error.issues.forEach((err: z.ZodIssue) => {
          if (err.path[0]) {
            formattedErrors[err.path[0].toString()] = err.message;
          }
        });
        setErrors(formattedErrors);
      }
    }
  };

  return (
    <div style={{ padding: 'var(--space-6) var(--space-5)', maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <button
        type="button"
        onClick={() => navigate(`/organizations/${orgId}/items`)}
        style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0, marginBottom: 'var(--space-4)', fontSize: 14, fontWeight: 500 }}
      >
        <ArrowLeft size={16} /> Back to Items
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-primary-50)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Package size={24} color="var(--color-primary)" />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>New Item</h1>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13 }}>Create a new inventory item or service.</p>
        </div>
      </div>

      <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-sm)' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Item Name <span style={{color: 'red'}}>*</span></label>
              <input
                name="name"
                value={formData.name}
                onChange={handleChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13 }}
                placeholder="e.g. Laptop"
              />
              {errors.name && <span style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.name}</span>}
            </div>
            
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>SKU <span style={{color: 'red'}}>*</span></label>
              <input
                name="sku"
                value={formData.sku}
                onChange={handleChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13 }}
                placeholder="e.g. LPT-001"
              />
              {errors.sku && <span style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.sku}</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Unit <span style={{color: 'red'}}>*</span></label>
              <select
                name="unit"
                value={formData.unit}
                onChange={handleChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13, background: 'white' }}
              >
                <option value="">Select Unit</option>
                <option value="pcs">pcs</option>
                <option value="kg">kg</option>
                <option value="box">box</option>
              </select>
              {errors.unit && <span style={{ color: 'red', fontSize: 12, marginTop: 4, display: 'block' }}>{errors.unit}</span>}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Category</label>
              <select
                name="category"
                value={formData.category || ''}
                onChange={handleChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13, background: 'white' }}
              >
                <option value="">Select Category</option>
                <option value="Electronics">Electronics</option>
                <option value="Furniture">Furniture</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Brand</label>
              <select
                name="brand"
                value={formData.brand || ''}
                onChange={handleChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13, background: 'white' }}
              >
                <option value="">Select Brand</option>
                <option value="Apple">Apple</option>
                <option value="Samsung">Samsung</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Manufacturer</label>
              <select
                name="manufacturer"
                value={formData.manufacturer || ''}
                onChange={handleChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13, background: 'white' }}
              >
                <option value="">Select Manufacturer</option>
                <option value="Foxconn">Foxconn</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Type</label>
              <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="radio" name="type" value="Goods" checked={formData.type === 'Goods'} onChange={() => handleRadioChange('type', 'Goods')} /> Goods
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="radio" name="type" value="Service" checked={formData.type === 'Service'} onChange={() => handleRadioChange('type', 'Service')} /> Service
                </label>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Item Type</label>
              <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="radio" name="itemType" value="Single Item" checked={formData.itemType === 'Single Item'} onChange={() => handleRadioChange('itemType', 'Single Item')} /> Single Item
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="radio" name="itemType" value="Contains Variants" checked={formData.itemType === 'Contains Variants'} onChange={() => handleRadioChange('itemType', 'Contains Variants')} /> Contains Variants
                </label>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Tax Preference <span style={{color: 'red'}}>*</span></label>
              <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="radio" name="taxPreference" value="Taxable" checked={formData.taxPreference === 'Taxable'} onChange={() => handleRadioChange('taxPreference', 'Taxable')} /> Taxable
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="radio" name="taxPreference" value="Non-Taxable" checked={formData.taxPreference === 'Non-Taxable'} onChange={() => handleRadioChange('taxPreference', 'Non-Taxable')} /> Non-Taxable
                </label>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>HSN Code</label>
              <input
                name="hsnCode"
                value={formData.hsnCode || ''}
                onChange={handleChange}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13 }}
                placeholder="e.g. 8471"
              />
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: 'var(--space-2) 0' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <input type="checkbox" name="isSalesInfo" checked={formData.isSalesInfo} onChange={handleChange} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Sales Information</h3>
          </div>
          
          {formData.isSalesInfo && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', paddingLeft: 24, marginBottom: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Selling Price (INR)</label>
                <input
                  type="number"
                  step="0.01"
                  name="sellingPrice"
                  value={formData.sellingPrice || ''}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Sales Account</label>
                <select
                  name="salesAccount"
                  value={formData.salesAccount || ''}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13, background: 'white' }}
                >
                  <option value="">Select Account</option>
                  <option value="Sales">Sales</option>
                  <option value="General Income">General Income</option>
                </select>
              </div>
            </div>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: 'var(--space-2) 0' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <input type="checkbox" name="isPurchaseInfo" checked={formData.isPurchaseInfo} onChange={handleChange} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Purchase Information</h3>
          </div>

          {formData.isPurchaseInfo && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', paddingLeft: 24 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Cost Price (INR)</label>
                <input
                  type="number"
                  step="0.01"
                  name="costPrice"
                  value={formData.costPrice || ''}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Purchase Account</label>
                <select
                  name="purchaseAccount"
                  value={formData.purchaseAccount || ''}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13, background: 'white' }}
                >
                  <option value="">Select Account</option>
                  <option value="Cost of Goods Sold">Cost of Goods Sold</option>
                  <option value="Inventory">Inventory</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>Packaging</label>
                <select
                  name="packaging"
                  value={formData.packaging || ''}
                  onChange={handleChange}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13, background: 'white' }}
                >
                  <option value="">Select Packaging</option>
                  <option value="Box">Box</option>
                  <option value="Carton">Carton</option>
                </select>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button
              type="button"
              onClick={() => navigate(`/organizations/${orgId}/items`)}
              style={{ background: 'white', color: 'var(--color-text)', border: '1px solid var(--color-border)', padding: '6px 16px', borderRadius: 'var(--radius-sm)', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              style={{ background: 'var(--color-primary)', color: 'white', border: 'none', padding: '6px 16px', borderRadius: 'var(--radius-sm)', fontWeight: 500, fontSize: 13, cursor: createMutation.isPending ? 'not-allowed' : 'pointer', opacity: createMutation.isPending ? 0.7 : 1 }}
            >
              {createMutation.isPending ? 'Saving...' : 'Save Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
