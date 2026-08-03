import { useState} from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, Folder, Plus, ChevronRight, ChevronDown, Edit2, Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { deleteItemCategory, createItemCategory, updateItemCategory } from '../../inventory/item-categories/item-categories.api';
import type { ItemCategory } from '../../inventory/item-categories/item-categories.api';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';

const categorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(200, 'Too long'),
  parentId: z.string().nullable().optional(),
});

type CategoryFormData = z.infer<typeof categorySchema>;

interface ManageCategoriesModalProps {
  categories: ItemCategory[];
  onClose: () => void;
  onSelectCategory?: (category: ItemCategory) => void;
}

export function ManageCategoriesModal({ categories, onClose, onSelectCategory }: ManageCategoriesModalProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [categoryToEdit, setCategoryToEdit] = useState<ItemCategory | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteItemCategory(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item-categories', orgId] });
    },
  });

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this category?')) {
      deleteMutation.mutate(id);
    }
  };

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormData>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: '',
      parentId: null,
    },
  });

  const handleEditCategory = (category: ItemCategory) => {
    setCategoryToEdit(category);
    setIsFormOpen(true);
    reset({
      name: category.name,
      parentId: category.parentId,
    });
  };

  const handleAddCategory = () => {
    setCategoryToEdit(null);
    setIsFormOpen(true);
    reset({
      name: '',
      parentId: null,
    });
  };

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['item-categories', orgId] });
    setCategoryToEdit(null);
    setIsFormOpen(false);
    reset({ name: '', parentId: null });
  };

  const createMutation = useMutation({
    mutationFn: (data: CategoryFormData) => createItemCategory(orgId!, data),
    onSuccess: handleSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: (data: CategoryFormData) => updateItemCategory(orgId!, categoryToEdit!.id, data),
    onSuccess: handleSuccess,
  });

  const onSubmit = (data: CategoryFormData) => {
    if (categoryToEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const handleCancel = () => {
    setCategoryToEdit(null);
    setIsFormOpen(false);
    reset({ name: '', parentId: null });
  };

  // Build hierarchy
  const rootCategories = categories.filter((c) => !c.parentId);
  const childrenMap = new Map<string, ItemCategory[]>();
  categories.forEach((c) => {
    if (c.parentId) {
      const children = childrenMap.get(c.parentId) || [];
      children.push(c);
      childrenMap.set(c.parentId, children);
    }
  });

  const renderCategoryNode = (category: ItemCategory, level = 0, isLastChild = true) => {
    const children = childrenMap.get(category.id) || [];
    const isExpanded = expandedIds.has(category.id);
    const hasChildren = children.length > 0;

    return (
      <div key={category.id} style={{ position: 'relative' }}>
        <div
          className="category-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            paddingLeft: level === 0 ? '16px' : `${20 + level * 20}px`,
            cursor: hasChildren ? 'pointer' : 'default',
            transition: 'background-color 0.15s ease',
            height: '40px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          onClick={(e) => {
            if (hasChildren) toggleExpand(category.id, e);
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            {level > 0 && (
              <>
                <div style={{
                  position: 'absolute',
                  left: `${4 + level * 20}px`,
                  top: 0,
                  height: isLastChild ? '20px' : '100%',
                  width: '1px',
                  backgroundColor: '#cbd5e1'
                }} />
                <div style={{
                  position: 'absolute',
                  left: `${4 + level * 20}px`,
                  top: '20px',
                  width: '12px',
                  height: '1px',
                  backgroundColor: '#cbd5e1'
                }} />
              </>
            )}
            
            {level === 0 && (
              <Folder size={16} style={{ color: '#3b82f6', marginRight: 8, fill: isExpanded || !hasChildren ? '#eff6ff' : 'transparent', flexShrink: 0 }} />
            )}
            
            <span style={{ 
              fontSize: 14, 
              color: '#334155', 
              fontWeight: level === 0 ? 500 : 400,
              textTransform: level === 0 ? 'uppercase' : 'none',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {category.name}
            </span>

            {hasChildren && (
              <div style={{ marginLeft: 6, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {isExpanded ? <ChevronDown size={14} color="#64748b" /> : <ChevronRight size={14} color="#64748b" />}
              </div>
            )}
          </div>

          <div className="category-actions" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {onSelectCategory && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectCategory(category);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 12,
                  color: '#475569',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#2563eb'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#475569'}
              >
                Apply this Category
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleEditCategory(category);
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 12,
                color: '#475569',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#2563eb'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#475569'}
            >
              <Edit2 size={12} />
              Edit
            </button>
            <button
              onClick={(e) => handleDelete(category.id, e)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 12,
                color: '#475569',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#475569'}
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        </div>
        
        {isExpanded && children.length > 0 && (
          <div style={{ position: 'relative' }}>
             {children.map((child, index) => renderCategoryNode(child, level + 1, index === children.length - 1))}
          </div>
        )}
      </div>
    );
  };

  const getDescendantIds = (categoryId: string): string[] => {
    const children = childrenMap.get(categoryId) || [];
    return children.reduce((acc, child) => {
      return [...acc, child.id, ...getDescendantIds(child.id)];
    }, [] as string[]);
  };

  const invalidParentIds = categoryToEdit ? [categoryToEdit.id, ...getDescendantIds(categoryToEdit.id)] : [];

  const flattenedCategories: { category: ItemCategory; level: number }[] = [];
  const flattenCategory = (category: ItemCategory, level: number) => {
    if (!invalidParentIds.includes(category.id)) {
      flattenedCategories.push({ category, level });
      const children = childrenMap.get(category.id) || [];
      children.forEach((child) => flattenCategory(child, level + 1));
    }
  };
  rootCategories.forEach((c) => flattenCategory(c, 0));

  const parentOptions = flattenedCategories.map(({ category }) => ({
    value: category.id,
    label: category.name,
  }));
  parentOptions.unshift({ value: '', label: 'Select Parent Category' });

  const levelMap = new Map<string, number>(
    flattenedCategories.map(({ category, level }) => [category.id, level])
  );

  return (
    <>
      <style>{`
        .category-row .category-actions {
          opacity: 0;
          transition: opacity 0.15s ease;
          pointer-events: none;
        }
        .category-row:hover .category-actions {
          opacity: 1;
          pointer-events: auto;
        }
      `}</style>
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 100,
        animation: 'uomModalFadeIn 0.2s ease-out forwards',
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
          width: '100%',
          maxWidth: 600,
          maxHeight: '85vh',
          boxShadow: 'var(--shadow-xl)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'uomModalSlideDown 0.3s ease-out forwards',
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#f8fafc',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: '#334155' }}>
            Manage Categories
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Section */}
        {isFormOpen && (
          <div style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: '12px' }}>
              <label style={{ fontSize: 13, color: '#ef4444' }}>Category Name*</label>
              <div style={{ width: '100%', maxWidth: 320 }}>
                <input
                  {...register('name')}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #93c5fd',
                    outline: 'none',
                    fontSize: 13,
                    color: '#334155'
                  }}
                />
                {errors.name && (
                  <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>
                    {errors.name.message}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: '12px' }}>
              <label style={{ fontSize: 13, color: '#475569' }}>Parent Category</label>
              <div style={{ width: '100%', maxWidth: 320 }}>
                <Controller
                  name="parentId"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      options={parentOptions}
                      value={field.value || ''}
                      onChange={(val) => field.onChange(val || null)}
                      placeholder="Select Parent Category"
                      renderOption={(option) => {
                        const level = levelMap.get(option.value) || 0;
                        return (
                          <div style={{ paddingLeft: level > 0 ? `${level * 16}px` : '0px' }}>
                            {level > 0 ? `• ${option.label}` : option.label}
                          </div>
                        );
                      }}
                      renderValue={(option) => option.label}
                    />
                  )}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={handleSubmit(onSubmit)}
                disabled={isSubmitting}
                style={{
                  background: '#166534',
                  color: 'white',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: 13,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting ? 0.7 : 1,
                }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  background: '#f8fafc',
                  color: '#334155',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  border: '1px solid #e2e8f0',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            padding: '16px 32px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid #f1f5f9',
            borderBottom: '1px solid #f1f5f9',
            backgroundColor: '#ffffff'
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155', letterSpacing: '0.5px' }}>
            CATEGORIES
          </span>
          {!isFormOpen && (
            <button
              onClick={handleAddCategory}
              style={{
                background: 'none',
                border: 'none',
                color: '#3b82f6',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Plus size={16} />
              Add New Category
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {rootCategories.length > 0 ? (
            rootCategories.map((c) => renderCategoryNode(c))
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
              No categories found. Create one above.
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
