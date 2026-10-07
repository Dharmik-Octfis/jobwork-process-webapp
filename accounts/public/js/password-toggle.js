/**
 * Show/hide the password on the sign-in and password forms.
 *
 * 🔴 This is the only script the identity provider serves, and it is deliberately
 * tiny, same-origin and dependency-free. The pages that include it carry a plaintext
 * password field, so every additional origin is another party that could read one
 * and every dependency is another supply chain in front of the login form. Served
 * from `/js/` on this host, it needs no CSP relaxation at all — helmet's default
 * `script-src 'self'` already allows it, and inline script would not be allowed.
 *
 * It never sends anything anywhere. It flips one attribute.
 */
(function () {
  'use strict';

  var EYE = 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z';
  var PUPIL_R = 2.2;

  function icon(shown) {
    // Two states, one path plus an optional slash. Inline SVG rather than an icon
    // font or an image request: no extra fetch, and it inherits `currentColor`.
    return (
      '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.4" aria-hidden="true" focusable="false">' +
      '<path d="' +
      EYE +
      '"/>' +
      '<circle cx="8" cy="8" r="' +
      PUPIL_R +
      '"/>' +
      (shown ? '<path d="M3 13L13 3"/>' : '') +
      '</svg>'
    );
  }

  function wire(button) {
    var input = document.getElementById(button.getAttribute('data-toggle-for'));
    if (!input) return;

    function render() {
      var shown = input.type === 'text';
      button.innerHTML = icon(shown);
      // `aria-pressed` is what tells a screen reader this is a toggle and which way
      // it currently sits; the label says what activating it will do.
      button.setAttribute('aria-pressed', shown ? 'true' : 'false');
      button.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
    }

    button.addEventListener('click', function () {
      var atEnd = input.selectionStart === input.value.length;
      input.type = input.type === 'password' ? 'text' : 'password';
      render();
      // Changing `type` drops the caret to the start in several browsers, which is
      // maddening mid-typing. Put it back where it was.
      input.focus();
      try {
        var pos = atEnd ? input.value.length : input.selectionStart;
        input.setSelectionRange(pos, pos);
      } catch {
        /* setSelectionRange throws on some input types; the focus still helped. */
      }
    });

    render();
  }

  function init() {
    var buttons = document.querySelectorAll('[data-toggle-for]');
    for (var i = 0; i < buttons.length; i += 1) wire(buttons[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
