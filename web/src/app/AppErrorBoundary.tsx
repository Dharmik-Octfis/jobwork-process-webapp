import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import styles from './AppErrorBoundary.module.css';

/**
 * What a user sees when a route throws.
 *
 * Without this, React Router falls back to its own developer page — the raw
 * minified stack plus "Hey developer 👋 You can provide a way better UX than
 * this" — which is what production users were actually shown when a component
 * hit a bad value mid-render.
 *
 * Mounted as `errorElement` on a pathless root route, so it covers every screen
 * including those outside `AppLayout` (login, invite accept). Errors bubble to
 * the nearest `errorElement`, and there is only this one.
 *
 * 🔴 It catches RENDER and loader errors, not event handlers or async work
 * outside render. A failed mutation still surfaces through its own error state;
 * this is the net for the crashes nothing else catches.
 */
export function AppErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  // A thrown Response (a loader's 404) reads differently from a crash, and
  // "something went wrong" for a missing record is just confusing.
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  const detail =
    error instanceof Error
      ? error.message
      : isRouteErrorResponse(error)
        ? `${error.status} ${error.statusText}`
        : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.card} role="alert">
        <h1 className={styles.title}>
          {isNotFound ? 'We could not find that page' : 'Something went wrong'}
        </h1>
        <p className={styles.body}>
          {isNotFound
            ? 'The link may be out of date, or the record may have been deleted.'
            : 'The page failed to load. Reloading usually clears it — if it keeps happening, tell us what you were doing.'}
        </p>

        {/* The message, never the stack. For an ApiEnvelopeError this names the
            URL and the shape that arrived, which is the one line worth reading
            and is safe to put in front of a user. */}
        {detail && <p className={styles.detail}>{detail}</p>}

        <div className={styles.actions}>
          <Button onClick={() => window.location.reload()}>Reload the page</Button>
          <Button variant="secondary" onClick={() => navigate('/')}>
            Go to the dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
