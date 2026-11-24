(() => {
  'use strict';
  const script = document.currentScript;
  const widgetId = script?.getAttribute('data-widget-id') || script?.getAttribute('data-kleva-widget');
  if (!script || !widgetId || !/^[A-Za-z0-9_-]{32,48}$/.test(widgetId)) return;
  const assetUrl = new URL(script.src);
  const frame = document.createElement('iframe');
  frame.title = 'Kleva customer support chat';
  frame.setAttribute('aria-label', 'Kleva customer support chat');
  frame.setAttribute('allow', 'clipboard-write');
  frame.setAttribute('loading', 'lazy');
  frame.style.cssText = 'position:fixed;z-index:2147483000;right:0;bottom:0;width:390px;height:88px;border:0;background:transparent;overflow:hidden;color-scheme:normal;';
  frame.src = new URL(`/public/widget-frame.html?widgetId=${encodeURIComponent(widgetId)}&siteOrigin=${encodeURIComponent(window.location.origin)}`, assetUrl.origin).toString();
  frame.addEventListener('load', () => frame.contentWindow?.postMessage({ type: 'kleva-widget-init' }, assetUrl.origin));
  const resize = (event) => {
    if (event.source !== frame.contentWindow || event.origin !== assetUrl.origin || event.data?.type !== 'kleva-widget-size') return;
    const mobile = window.matchMedia('(max-width: 480px)').matches;
    if (mobile && event.data.open) {
      frame.style.left = '0'; frame.style.right = '0'; frame.style.top = '0'; frame.style.bottom = '0'; frame.style.width = '100vw'; frame.style.height = '100dvh';
    } else if (mobile) {
      frame.style.left = '0'; frame.style.right = '0'; frame.style.top = 'auto'; frame.style.bottom = '0'; frame.style.width = '100vw'; frame.style.height = '88px';
    } else {
      frame.style.left = '';
      frame.style.top = '';
      frame.style.right = event.data.position === 'bottom-left' ? 'auto' : '0';
      frame.style.left = event.data.position === 'bottom-left' ? '0' : 'auto';
      frame.style.bottom = '0';
      frame.style.width = '390px';
      frame.style.height = event.data.open ? '620px' : '88px';
    }
  };
  window.addEventListener('message', resize);
  window.addEventListener('pagehide', () => window.removeEventListener('message', resize), { once: true });
  document.body.appendChild(frame);
})();
