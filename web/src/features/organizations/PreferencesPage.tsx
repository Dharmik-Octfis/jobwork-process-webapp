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
      migrationDate: z.string().optional(),
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
        migrationDate: '',
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
          migrationDate: activeOrg.settings?.migrationDate || '',
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#fff' }}>
      <header
        style={{
          padding: '0 32px',
          height: '60px',
          flexShrink: 0,
          boxSizing: 'border-box',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: '#fff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--navy-900)', margin: 0 }}>
            Preferences
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: 0 }}>
            Manage default terminology and settings for this organization.
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <main style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
          <div style={{ maxWidth: '800px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '24px',
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
              marginTop: '32px',
              paddingTop: '32px',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
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
                    fontSize: '15px',
                    color: 'var(--navy-900)',
                    fontWeight: 500,
                  }}
                >
                  Track individual units inside each {trackingSingular}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--color-text-muted)',
                    marginTop: '4px',
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
                  gap: '24px',
                  marginTop: '24px',
                  paddingLeft: '28px',
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

          <div
            style={{
              marginTop: '32px',
              paddingTop: '32px',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '388px' }}>
              <Input
                type="date"
                label="Migration Date"
                error={errors.settings?.migrationDate?.message}
                hint="The starting date for reports and opening balances."
                {...register('settings.migrationDate')}
              />
            </div>
          </div>

          </div>
        </main>

        <footer style={{
          padding: '16px 32px',
          borderTop: '1px solid var(--color-border)',
          backgroundColor: '#fff',
          display: 'flex',
          justifyContent: 'flex-start',
        }}>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              padding: '10px 24px',
              fontSize: '15px',
              fontWeight: 500,
              backgroundColor: 'var(--navy-900)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
              transition: 'background-color 0.2s',
            }}
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </footer>
      </form>
    </div>
  );
}
