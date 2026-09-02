import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'react-hot-toast';
import { z } from 'zod';
import { organizationsApi } from './organizations.api';
import { toApiErrorMessage } from '../../api/client';
import { Input } from '../../components/ui/Input';
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
    } catch (err: unknown) {
      toast.error(toApiErrorMessage(err));
    }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', backgroundColor: 'var(--color-bg)' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: 'var(--space-6)' }}>
        <main>
          <section className="org-form-card" style={{ maxWidth: '100%', padding: 'var(--space-6)' }}>
            <div className="org-form-header" style={{ marginBottom: 'var(--space-6)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-4)' }}>
              <h2 style={{ fontSize: '24px', color: 'var(--navy-900)', marginBottom: '8px' }}>Preferences</h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>Manage default terminology and settings for this organization.</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="org-form-content">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-4)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <Input
                    label="Item Tracking Label (Singular)"
                    placeholder="e.g. Batch, Lot, Roll"
                    error={errors.settings?.itemTrackingLabel?.singular?.message}
                    hint="Term used for single units."
                    {...register('settings.itemTrackingLabel.singular')}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <Input
                    label="Item Tracking Label (Plural)"
                    placeholder="e.g. Batches, Lots, Rolls"
                    error={errors.settings?.itemTrackingLabel?.plural?.message}
                    hint="Term used for multiple units."
                    {...register('settings.itemTrackingLabel.plural')}
                  />
                </div>
              </div>

              <div className="org-form-actions" style={{ marginTop: 'var(--space-6)' }}>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="org-form-submit-btn"
                  style={{ padding: '8px 24px', fontSize: '15px' }}
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
