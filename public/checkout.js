/**
 * Handova checkout: add "Pay rent from any chain" to any website.
 *
 *   <script src="https://handova-near.vercel.app/checkout.js" defer></script>
 *   <button data-handova-listing="7">Pay rent</button>
 *
 * The button opens Handova's checkout for that listing in a small window. The payer signs in (or
 * creates an account), pays with USDC on NEAR or from another chain through NEAR Intents, gas-free,
 * and the money waits in the escrow contract until they confirm they moved in. When the payment
 * lands, the button receives a `handova:paid` event with
 * { listingId, leaseId, tenant, amount (USDC, 6 decimals), tx }. All of it is public on-chain.
 *
 * Or from code: Handova.checkout(7).then((paid) => …)
 * The site never touches keys or funds; it only learns that a lease was paid.
 */
(() => {
  const script = document.currentScript;
  const origin = new URL(script ? script.src : location.href).origin;

  function checkout(listingId) {
    return new Promise((resolve, reject) => {
      const url = `${origin}/#/checkout/${encodeURIComponent(listingId)}`;
      const w = 440, h = 760;
      const popup = window.open(url, 'handova-checkout', `popup,width=${w},height=${h},left=${Math.max(0, (screen.width - w) / 2)},top=${Math.max(0, (screen.height - h) / 2)}`);
      if (!popup) {
        // Popup blocked: open in this tab instead (no event comes back).
        location.href = url;
        return reject(new Error('popup blocked'));
      }
      const onMessage = (e) => {
        if (e.origin !== origin || e.source !== popup || !e.data || e.data.type !== 'handova:paid') return;
        cleanup();
        const { type, ...paid } = e.data;
        resolve(paid);
      };
      const timer = setInterval(() => { if (popup.closed) { cleanup(); reject(new Error('closed')); } }, 800);
      const cleanup = () => { removeEventListener('message', onMessage); clearInterval(timer); };
      addEventListener('message', onMessage);
    });
  }

  document.addEventListener('click', (e) => {
    const el = e.target instanceof Element && e.target.closest('[data-handova-listing]');
    if (!el) return;
    e.preventDefault();
    checkout(el.getAttribute('data-handova-listing')).then(
      (paid) => el.dispatchEvent(new CustomEvent('handova:paid', { detail: paid, bubbles: true })),
      () => {},
    );
  });

  window.Handova = Object.assign(window.Handova || {}, { checkout });
})();
