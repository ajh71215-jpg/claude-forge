// Cheap pre-flight (NO model call): is the app at MainShell or the AuthGate?
(() => {
  const q = (s) => document.querySelector(s)
  const txt = (s) => (q(s)?.textContent || '').trim()
  return {
    shellPresent: !!q('.shell'),
    authGatePresent: !!q('.auth, .authgate, [class*=auth]'),
    connLabel: txt('.conn-label'),
    connMethod: txt('.conn-method'),
    modelCount: document.querySelectorAll('.model-card').length,
    localCost: txt('.local-cost'),
    boot: txt('.boot')
  }
})()
