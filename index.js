let url = 'https://dev-landing-v2.onaim.io/?lang=en&landingPageId=7066&promotionId=5724&tenantCode=dev&ott=559';

const get = (id) => document.getElementById(id);
const sdkLoads = new Map();
const SDK_LOAD_TIMEOUT_MS = 420000;
let activeSdkKey = null;
let revision = 0;

function normalizeUrl(value) {
  const input = value.trim();
  if (!input) throw new Error('შეიყვანე URL.');
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('გამოიყენე HTTP ან HTTPS მისამართი, მომხმარებლის სახელისა და პაროლის გარეშე.');
  }
  return url.href;
}

function resetPreview() {
  get('componentHost').replaceChildren();
  get('componentHost').hidden = true;
  get('widgetPlaceholder').style.display = 'flex';
}

function loadSdk(url, isModule, onSlowLoad) {
  const key = `${isModule}:${url}`;
  if (!sdkLoads.has(key)) {
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const slowTimer = setTimeout(() => onSlowLoad?.(), 20000);
      const timer = setTimeout(() => fail('timeout'), SDK_LOAD_TIMEOUT_MS);
      function cleanup() {
        clearTimeout(timer);
        clearTimeout(slowTimer);
        script.onload = null;
        script.onerror = null;
      }
      function fail(reason) {
        cleanup();
        script.remove();
        console.error('ONAIM SDK load failed', { url, reason });
        reject(new Error(reason === 'timeout'
          ? `SDK-ის ჩატვირთვას ${Math.ceil(SDK_LOAD_TIMEOUT_MS / 60000)} წუთზე მეტი დასჭირდა. გადაამოწმე ინტერნეტი და დააჭირე Sync-ს ხელახლა.`
          : 'SDK-ის მოთხოვნა ჩავარდა. სცადე სხვა ქსელი; გადაამოწმე SDK-ის მისამართი და ბრაუზერის Network/Console.'));
      }
      if (isModule) script.type = 'module';
      script.defer = true;
      script.src = url;
      script.onload = () => { cleanup(); resolve(); };
      script.onerror = () => fail('network-or-blocked');
      document.head.append(script);
    });
    sdkLoads.set(key, promise);
    promise.catch(() => sdkLoads.delete(key));
  }
  return sdkLoads.get(key);
}

function waitForComponent() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SDK-მ onaim-landing-page ვერ დაარეგისტრირა. გადაამოწმე SDK და ES module პარამეტრი.')), 10000);
    customElements.whenDefined('onaim-landing-page').then(() => { clearTimeout(timer); resolve(); });
  });
}

function readSdk() {
  const template = document.createElement('template');
  template.innerHTML = get('sdkMarkup').value;
  const scripts = template.content.querySelectorAll('script');
  if (scripts.length !== 1 || !scripts[0].getAttribute('src')) {
    throw new Error('ჩასვი ერთი script ტეგი JavaScript src მისამართით.');
  }
  const script = scripts[0];
  const type = script.getAttribute('type');
  if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) {
    throw new Error('script-ის ტიპი უნდა იყოს JavaScript ან module.');
  }
  return { url: normalizeUrl(script.getAttribute('src')), isModule: type === 'module' };
}

function readAttributes(url) {
  const attributes = {};
  if (!url) {
    // Parse only manual mode; a new URL never inherits a previous landing's token or IDs.
    const template = document.createElement('template');
    template.innerHTML = get('componentMarkup').value;
    const components = template.content.querySelectorAll('onaim-landing-page');
    if (components.length !== 1) throw new Error('ჩასვი სრული URL ან ერთი onaim-landing-page ელემენტი.');
    for (const name of ['promotion-id', 'landing-page-id', 'tenant-code', 'language', 'enable-signalr', 'otp']) {
      const value = components[0].getAttribute(name);
      if (value !== null) attributes[name] = value;
    }
  }
  if (url) {
    const params = new URL(url).searchParams;
    const overrides = {
      'promotion-id': params.get('promotionId') || params.get('promotion-id'),
      'landing-page-id': params.get('landingPageId') || params.get('landing-page-id'),
      'tenant-code': params.get('tenantCode') || params.get('tenant-code'),
      language: params.get('lang') || params.get('language') || 'en',
      'enable-signalr': params.get('enable-signalr'),
      otp: params.get('otp') || params.get('ott') || params.get('one-time-token')
    };
    for (const [name, value] of Object.entries(overrides)) {
      if (value !== null) attributes[name] = value;
    }
  }
  for (const name of ['promotion-id', 'landing-page-id', 'tenant-code']) {
    if (!attributes[name]?.trim()) throw new Error((url ? 'URL-ში აკლია ' : 'ელემენტში აკლია ') + name + ' პარამეტრი.');
  }
  if (attributes['enable-signalr'] !== undefined && !['true', 'false'].includes(attributes['enable-signalr'])) {
    throw new Error('enable-signalr უნდა იყოს true ან false.');
  }
  return attributes;
}

function sdkFromLandingUrl(url) {
  const landing = new URL(url);
  const directUrl = new URL('/widget/onaim-landing-page.js', landing).href;
  const hosted = ['http:', 'https:'].includes(window.location.protocol)
    && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if (hosted && landing.origin === 'https://qa-landing-v2.onaim.io') {
    // Keep /widget/ in the path: the SDK resolves ../env.js from its script URL.
    // vercel.json forwards this whole prefix, including env.js, to the QA origin.
    return {
      url: new URL('/onaim/widget/onaim-landing-page.js', window.location.origin).href,
      fallbackUrl: directUrl,
      isModule: false
    };
  }
  return { url: directUrl, isModule: false };
}

function showGeneratedCode(sdk, attributes) {
  const escapeAttribute = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  get('sdkMarkup').value = `<script defer src="${escapeAttribute(sdk.url)}"></script>`;
  const lines = Object.entries(attributes).map(([name, value]) => `  ${name}="${escapeAttribute(value)}"`).join('\n');
  get('componentMarkup').value = `<onaim-landing-page\n${lines}>\n</onaim-landing-page>`;
}

function createLandingShell() {
  const shell = document.createElement('div');
  shell.className = 'landing-shell';
  const header = document.createElement('div');
  header.className = 'landing-shell-header';
  const title = document.createElement('h1');
  title.className = 'landing-shell-title';
  title.textContent = get('landingTitle').value.trim();
  if (title.textContent) header.append(title);
  const actions = document.createElement('div');
  actions.className = 'landing-shell-actions';
  const balanceValue = get('landingBalance').value.trim();
  if (balanceValue) {
    if (!/^\d+$/.test(balanceValue)) throw new Error('ბალანსი უნდა იყოს არაუარყოფითი მთელი რიცხვი.');
    const balance = document.createElement('span');
    balance.className = 'landing-shell-balance';
    balance.setAttribute('aria-label', `Tu saldo: ${balanceValue} fichas`);
    const label = document.createElement('span');
    label.textContent = 'Tu saldo';
    const coin = document.createElement('span');
    coin.className = 'landing-shell-coin';
    coin.setAttribute('aria-hidden', 'true');
    coin.textContent = 'DJ';
    const amount = document.createElement('strong');
    amount.textContent = balanceValue;
    const unit = document.createElement('span');
    unit.textContent = 'fichas';
    balance.append(label, coin, amount, unit);
    actions.append(balance);
  }
  const backValue = get('landingBackUrl').value.trim();
  if (backValue) {
    const backUrl = new URL(backValue, window.location.href);
    if (!['https:', 'http:'].includes(backUrl.protocol) && !(window.location.protocol === 'file:' && backValue.startsWith('/'))) {
      throw new Error('დაბრუნების ბმული უნდა იყოს HTTP/HTTPS ან საიტის შიდა მისამართი.');
    }
    const back = document.createElement('a');
    back.className = 'landing-shell-back';
    back.href = backValue;
    back.textContent = 'Volver a DJ Fichas';
    actions.append(back);
  }
  header.append(actions);
  shell.append(header);
  return shell;
}

function finish() {
  get('loadButton').disabled = false;
  get('loadButton').textContent = 'Sync';
}

async function loadLanding() {
  const current = ++revision;
  try {
    const landingUrl = normalizeUrl(url);
    const attributes = readAttributes(landingUrl);
    const shell = createLandingShell();
    const sdk = sdkFromLandingUrl(landingUrl);
    const sdkKey = `${sdk.isModule}:${sdk.url}`;
    const componentRegistered = Boolean(customElements.get('onaim-landing-page'));
    if (componentRegistered && activeSdkKey && activeSdkKey !== sdkKey) {
      throw new Error('სხვა SDK-ზე გადასასვლელად განაახლე გვერდი და ჩასვი ახალი script.');
    }
    showGeneratedCode(sdk, attributes);
    resetPreview();
    get('statusText').textContent = 'იტვირთება…';
    get('loadButton').disabled = true;
    get('loadButton').textContent = 'Sync…';
    if (!componentRegistered) {
      const onSlowLoad = () => {
        if (current === revision) get('statusText').textContent = 'SDK ჯერ იტვირთება. ნელ ქსელზე ამას მეტი დრო სჭირდება…';
      };
      try {
        await loadSdk(sdk.url, sdk.isModule, onSlowLoad);
      } catch (error) {
        if (current !== revision) return;
        if (!sdk.fallbackUrl || customElements.get('onaim-landing-page')) throw error;
        get('statusText').textContent = 'Vercel-იდან SDK ვერ ჩაიტვირთა. ვცდილობ პირდაპირ ONAIM-იდან…';
        await loadSdk(sdk.fallbackUrl, sdk.isModule, onSlowLoad);
      }
      activeSdkKey = sdkKey;
    }
      if (current !== revision) return;
      await waitForComponent();
      if (current !== revision) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'relative';
      const transition = document.createElement('div');
      transition.className = 'transition-opacity duration-300';
      transition.setAttribute('aria-hidden', 'false');
      const content = document.createElement('div');
      content.className = 'w-full';
      const component = document.createElement('onaim-landing-page');
      for (const [name, value] of Object.entries(attributes)) component.setAttribute(name, value);
      content.append(component);
      transition.append(content);
      wrapper.append(transition);
      shell.append(wrapper);
      get('componentHost').append(shell);
      get('componentHost').hidden = false;
      get('widgetPlaceholder').style.display = 'none';
      get('statusText').textContent = 'ONAIM კომპონენტი ჩასმულია. შიგთავსს SDK ტვირთავს.';
  } catch (error) {
    if (current === revision) get('statusText').textContent = error instanceof TypeError ? 'URL არასწორია. შეიყვანე სრული მისამართი.' : error.message;
  } finally {
    if (current === revision) finish();
  }
}

get('loadButton').addEventListener('click', loadLanding);
get('clearButton').addEventListener('click', () => {
  revision++;
  resetPreview();
  get('statusText').textContent = 'მზადაა ჩასატვირთად';
  finish();
});
// Render automatically using the URL configured at the top of this file.
loadLanding();

document.querySelectorAll('.bottom-nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.bottom-nav-item').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    // Host pages can connect their own routes or panels to this event.
    document.dispatchEvent(new CustomEvent('landing-navigation', {
      detail: { section: button.dataset.nav }
    }));
  });
});

