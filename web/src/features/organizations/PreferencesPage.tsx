import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
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
  settings: z
    .object({
      itemTrackingLabel: z
        .object({
          singular: z.string().min(1, 'Required').max(30),
          plural: z.string().min(1, 'Required').max(30),
        })
        .optional(),
      /**
       * The optional level below a batch. The two names are only REQUIRED once the
       * level is switched on — demanding them while the toggle is off would block a
       * save of the batch labels alone, which is the only thing most orgs ever
       * change here.
       */
      batchUnit: z
        .object({
          enabled: z.boolean(),
          singular: z.string().max(30),
          plural: z.string().max(30),
        })
        .superRefine((value, ctx) => {
          if (!value.enabled) return;
          if (!value.singular.trim())
            ctx.addIssue({ code: 'custom', path: ['singular'], message: 'Required' });
          if (!value.plural.trim())
            ctx.addIssue({ code: 'custom', path: ['plural'], message: 'Required' });
        })
        .optional(),
    })
    .optional(),
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
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PreferencesData>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: {
      settings: {
        itemTrackingLabel: {
          singular: 'Batch',
          plural: 'Batches',
        },
        batchUnit: {
          enabled: false,
          singular: 'Taka',
          plural: 'Takas',
        },
      },
    },
  });

  /** The two name fields exist only while the level is on — see the schema. */
  const batchUnitEnabled = watch('settings.batchUnit.enabled') ?? false;
  /** What THIS org calls a batch, so the toggle reads in their own words. */
  const trackingSingular = watch('settings.itemTrackingLabel.singular') || 'Batch';

  useEffect(() => {
    if (activeOrg) {
      reset({
        settings: {
          itemTrackingLabel: {
            singular: activeOrg.settings?.itemTrackingLabel?.singular || 'Batch',
            plural: activeOrg.settings?.itemTrackingLabel?.plural || 'Batches',
          },
          batchUnit: {
            enabled: activeOrg.settings?.batchUnit?.enabled === true,
            singular: activeOrg.settings?.batchUnit?.singular || 'Taka',
            plural: activeOrg.settings?.batchUnit?.plural || 'Takas',
          },
        },
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
          <section
            className="org-form-card"
            style={{ maxWidth: '100%', padding: 'var(--space-6)' }}
          >
            <div
              className="org-form-header"
              style={{
                marginBottom: 'var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: 'var(--space-4)',
              }}
            >
              <h2 style={{ fontSize: '24px', color: 'var(--navy-900)', marginBottom: '8px' }}>
                Preferences
              </h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>
                Manage default terminology and settings for this organization.
              </p>
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

              {/* ── The optional level BELOW a batch ──────────────────────────
                  Off by default and off for every existing organization, because
                  a level nobody asked for is a column of empty inputs on six
                  screens. Switching it on is what makes the "Add <unit>" control
                  appear inside the Add <batches> window. */}
              <div
                style={{
                  marginTop: 'var(--space-6)',
                  paddingTop: 'var(--space-5)',
                  borderTop: '1px solid var(--color-border)',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ marginTop: '3px', width: '16px', height: '16px', cursor: 'pointer' }}
                    {...register('settings.batchUnit.enabled')}
                  />
                  <span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '14px',
                        color: 'var(--navy-900)',
                        fontWeight: 500,
                      }}
                    >
                      Track individual units inside each {trackingSingular}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: '12.5px',
                        color: 'var(--color-text-muted)',
                        marginTop: '2px',
                      }}
                    >
                      Adds one more level below a {trackingSingular.toLowerCase()} — each roll, bale
                      or piece gets its own label and quantity, so it can be issued and traced on
                      its own.
                    </span>
                  </span>
                </label>

                {batchUnitEnabled && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 'var(--space-4)',
                      marginTop: 'var(--space-4)',
                      paddingLeft: '26px',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <Input
                        label="Unit Label (Singular)"
                        placeholder="e.g. Taka, Roll, Bale"
                        error={errors.settings?.batchUnit?.singular?.message}
                        hint="Term used for a single unit."
                        {...register('settings.batchUnit.singular')}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <Input
                        label="Unit Label (Plural)"
                        placeholder="e.g. Takas, Rolls, Bales"
                        error={errors.settings?.batchUnit?.plural?.message}
                        hint="Term used for multiple units."
                        {...register('settings.batchUnit.plural')}
                      />
                    </div>
                  </div>
                )}
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
