/**
 * EchoSupport embed loader (~1 KB)
 * Usage: <script src="https://your-domain.com/embed.js" data-agent-key="pk_..." data-api-base="https://your-domain.com" defer></script>
 */
(function () {
  const currentScript: HTMLOrSVGScriptElement | null = document.currentScript;

  if (!currentScript) return;

  const embedScript = currentScript as HTMLScriptElement;
  const embedUrl = new URL(embedScript.src);
  const assetVersion = embedUrl.searchParams.get('v');
  const agentKey = embedScript.getAttribute('data-agent-key') ?? '';
  const apiBase = embedScript.getAttribute('data-api-base') ?? embedUrl.origin;
  const language = embedScript.getAttribute('data-language');

  if (!agentKey) {
    console.warn('[EchoSupport] data-agent-key attribute is missing on embed script');
    return;
  }

  function appendWidget() {
    if (document.querySelector('echo-support-widget')) return;
    const el = document.createElement('echo-support-widget');
    el.setAttribute('agent-key', agentKey);
    el.setAttribute('api-base', apiBase);
    if (language === 'ru' || language === 'en') el.setAttribute('language', language);
    document.body.appendChild(el);
  }

  function mount() {
    if (customElements.get('echo-support-widget')) {
      // Widget bundle already loaded, just create the element
      appendWidget();
      return;
    }

    const scriptUrl = new URL(apiBase.replace(/\/$/, '') + '/widget.js');
    if (assetVersion) scriptUrl.searchParams.set('v', assetVersion);
    const scriptSrc = scriptUrl.toString();
    const s = document.createElement('script');
    s.src = scriptSrc;
    s.defer = true;
    s.onload = appendWidget;
    s.onerror = function () {
      console.warn('[EchoSupport] Failed to load widget bundle:', scriptSrc);
    };
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
