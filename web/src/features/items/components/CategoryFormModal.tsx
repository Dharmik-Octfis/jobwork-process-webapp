import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createItemCategory, updateItemCategory } from '../../inventory/item-categories/item-categories.api';
import type { ItemCategory } from '../../inventory/item-categories/item-categories.api';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { useParams } from 'react-router-dom';

const categorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(200, 'Too long'),
  parentId: z.string().nullable().optional(),
});

type CategoryFormData = z.infer<typeof categorySchema>;

interface CategoryFormModalProps {
  categoryToEdit?: ItemCategory | null;
  categories: ItemCategory[];
  onClose: () => void;
  onSuccess?: (category: ItemCategory) => void;
}

export function CategoryFormModal({
  categoryToEdit,
  categories,
  onClose,
  onSuccess,
}: CategoryFormModalProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

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

  useEffect(() => {
    if (categoryToEdit) {
      reset({
        name: categoryToEdit.name,
        parentId: categoryToEdit.parentId,
      });
    }
  }, [categoryToEdit, reset]);

  const createMutation = useMutation({
    mutationFn: (data: CategoryFormData) => createItemCategory(orgId!, data),
    onSuccess: (newCategory) => {
      queryClient.invalidateQueries({ queryKey: ['item-categories', orgId] });
      onSuccess?.(newCategory);
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: CategoryFormData) => updateItemCategory(orgId!, categoryToEdit!.id, data),
    onSuccess: (updatedCategory) => {
      queryClient.invalidateQueries({ queryKey: ['item-categories', orgId] });
      onSuccess?.(updatedCategory);
      onClose();
    },
  });

  const onSubmit = (data: CategoryFormData) => {
    if (categoryToEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  // Prevent selecting self or children as parent
  const parentOptions = categories
    .filter((c) => c.id !== categoryToEdit?.id)
    .map((c) => ({
      value: c.id,
      label: c.name,
    }));

  parentOptions.unshift({ value: '', label: 'Select Parent Category' });

  return (
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
          maxWidth: 400,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '85vh',
          animation: 'uomModalSlideDown 0.3s ease-out forwards',
        }}
      >
        <div
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            {categoryToEdit ? 'Edit Category' : 'New Category'}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-5)' }}>
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-danger)' }}>
                Category Name*
              </label>
              <input
                {...register('name')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  fontSize: 13,
                }}
              />
              {errors.name && (
                <span style={{ color: 'var(--color-danger)', fontSize: 11 }}>
                  {errors.name.message}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>
                Parent Category
              </label>
              <Controller
                name="parentId"
                control={control}
                render={({ field }) => (
                  <SearchableSelect
                    options={parentOptions}
                    value={field.value || ''}
                    onChange={(val) => field.onChange(val || null)}
                    placeholder="Select Parent Category"
                  />
                )}
              />
            </div>
          </div>
        </div>

        <div
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'flex-start',
            gap: 'var(--space-3)',
            backgroundColor: '#f8fafc',
            borderBottomLeftRadius: 'var(--radius-lg)',
            borderBottomRightRadius: 'var(--radius-lg)',
          }}
        >
          <button
            type="button"
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            style={{
              background: '#166534',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'white',
              border: '1px solid var(--color-border)',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
