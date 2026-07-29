import { Spinner } from '../ui/Spinner';

/**
 * Shown while a lazily-loaded route chunk is in flight (see `app/router.tsx`).
 *
 * It fills the content area rather than the page: the boundary sits around each
 * layout's `<Outlet />`, so the sidebar and header stay put and only the page
 * body swaps. Centred and unstyled beyond that on purpose — on a warm cache the
 * chunk is already there and this never paints at all, so anything more elaborate
 * would be a flash of layout most users never see.
 */
export function RouteFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        width: '100%',
      }}
    >
      <Spinner size={24} label="Loading page" />
    </div>
  );
}
