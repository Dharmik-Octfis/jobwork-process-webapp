/**
 * Submit the provider's logout form the moment the page loads.
 *
 * 🔴 This exists as a file rather than an inline `<script>` because helmet's default
 * `script-src 'self'` blocks inline script on every page this service serves — the
 * same reason `password-toggle.js` is a file. An inline version fails silently in
 * the browser and the user is left staring at a page that never submits.
 *
 * The form itself carries `logout=yes`, so if this never runs (script blocked, JS
 * off) the `<noscript>` button submits exactly the same request by hand. Either way
 * the request is identical; this only removes the click.
 */
(function () {
  'use strict';

  function submit() {
    var form = document.getElementById('op.logoutForm');
    // Nothing to do if the provider changed the form id — the noscript button is
    // still on the page, so the user can finish the sign-out themselves.
    if (form) form.submit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', submit);
  } else {
    submit();
  }
})();
