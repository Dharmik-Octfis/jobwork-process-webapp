import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'react-hot-toast';
import { z } from 'zod';
import { organizationsApi } from './organizations.api';
import { toApiErrorMessage } from '../../api/client';
import './CreateOrganizationForm.css'; // Re-use styles

const preferencesSchema = z.object({
  settings: z.object({
    itemTrackingLabel: z.object({
      singular: z.string().min(1, 'Required').max(30),
      plural: z.string().min(1, 'Required').max(30),
    }).optional()
  }).optional(),
});

type PreferencesData = z.infer<typeof preferencesSchema>;

export function PreferencesPage() {
  const { orgId: id } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    staleTime: 5 * 60 * 1000,
  });

  const activeOrg = organizations?.find((o) => o.organizationId === id);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PreferencesData>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: {
      settings: {
        itemTrackingLabel: {
          singular: 'Batch',
          plural: 'Batches',
        }
      }
    },
  });

  useEffect(() => {
    if (activeOrg) {
      reset({
        settings: {
          itemTrackingLabel: {
            singular: activeOrg.settings?.itemTrackingLabel?.singular || 'Batch',
            plural: activeOrg.settings?.itemTrackingLabel?.plural || 'Batches',
          }
        }
      });
    }
  }, [activeOrg, reset]);

  const onSubmit = async (data: PreferencesData) => {
    if (!id) return;
    try {
      await organizationsApi.updateOrganization(id, data);
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast.success('Preferences updated successfully');
    } catch (err: unknown) {
      toast.error(toApiErrorMessage(err));
    }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: 'var(--space-6)' }}>
        <main>
          <section className="org-form-section">
            <div className="org-form-header">
              <h2>Preferences</h2>
              <p>Manage default terminology and settings for this organization.</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="org-form-content">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-2)',
                }}
              >
                <div className="org-form-group">
                  <label>Item Tracking Label (Singular)</label>
                  <input
                    type="text"
                    className={`org-form-input ${errors.settings?.itemTrackingLabel?.singular ? 'error' : ''}`}
                    placeholder="e.g. Batch, Lot, Roll"
                    {...register('settings.itemTrackingLabel.singular')}
                  />
                  <p style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Term used for single units.
                  </p>
                </div>
                <div className="org-form-group">
                  <label>Item Tracking Label (Plural)</label>
                  <input
                    type="text"
                    className={`org-form-input ${errors.settings?.itemTrackingLabel?.plural ? 'error' : ''}`}
                    placeholder="e.g. Batches, Lots, Rolls"
                    {...register('settings.itemTrackingLabel.plural')}
                  />
                  <p style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Term used for multiple units.
                  </p>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginTop: 'var(--space-4)',
                  paddingTop: 'var(--space-2)',
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    background: 'var(--color-primary)',
                    color: 'white',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 600,
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: isSubmitting ? 0.7 : 1,
                  }}
                >
                  {isSubmitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
