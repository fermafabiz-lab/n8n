import { workflow, node, trigger } from '@n8n/workflow-sdk';

// Is the site being served the build you think it is? — asked from a Claude
// session, which cannot reach the site itself (db/port/lib/README.md).
//
// The login page is the one page served without a password, and every page
// links the same global stylesheet and the root layout's scripts. So a class
// added to platform/app/globals.css, or a string only the new build's layout
// code contains, is in what /login links the moment the new container is up —
// and not a second before. A green deploy job says the image was pulled; this
// says it is the one answering. Run it once per deploy with a needle only the
// new build has:
//
//   execute_workflow(id, 'manual', { type: 'webhook', webhookData: { method: 'POST', body: { needle: '.autostep{' } } })
//
// read `Verdict` (served: true, and which file carried it), then archive the
// workflow. First used for deploy #185 (a CSS class, hands-off by step); since
// deploy #186 it reads the page's scripts too, because a change that touches
// only a component in the layout (the credits strip) leaves the CSS alone.

const start = trigger({
  type: 'n8n-nodes-base.webhook', version: 2,
  config: { name: 'Needle', parameters: { httpMethod: 'POST', path: 'zz-served-css', responseMode: 'onReceived', options: {} }, position: [240, 300] },
  output: [{ body: { needle: '.autostep{' } }]
});

const login = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'GET /login',
    parameters: {
      method: 'GET',
      url: 'http://web:3000/login',
      options: { response: { response: { responseFormat: 'text', outputPropertyName: 'html', neverError: true } } }
    },
    position: [480, 300]
  },
  output: [{ html: '<html></html>' }]
});

const links = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Stylesheets',
    parameters: {
      jsCode: "const html = String($json.html || '');\nconst needle = $('Needle').first().json.body.needle;\nconst hrefs = [...new Set(html.match(/\\/_next\\/static\\/(?:css|chunks)\\/[A-Za-z0-9._\\/-]+\\.(?:css|js)/g) || [])];\nif (hrefs.length === 0) return [{ json: { href: null, needle, htmlBytes: html.length } }];\nreturn hrefs.map((href) => ({ json: { href, needle } }));"
    },
    position: [720, 300]
  },
  output: [{ href: '/_next/static/css/x.css', needle: '.autostep{' }]
});

const css = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.4,
  config: {
    name: 'GET stylesheet',
    parameters: {
      method: 'GET',
      url: '={{ "http://web:3000" + ($json.href || "/login") }}',
      options: { response: { response: { responseFormat: 'text', outputPropertyName: 'css', neverError: true } } }
    },
    position: [960, 300]
  },
  output: [{ css: '' }]
});

const verdict = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Verdict',
    parameters: {
      jsCode: "const needle = $('Needle').first().json.body.needle;\nconst hrefs = $('Stylesheets').all().map((i) => i.json.href);\nconst rows = $input.all().map((it, i) => {\n  const body = String(it.json.css || '');\n  return { href: hrefs[i], bytes: body.length, has: hrefs[i] !== null && body.includes(needle) };\n});\nreturn [{ json: { needle, served: rows.some((r) => r.has), carriedBy: rows.filter((r) => r.has).map((r) => r.href), files: rows.length } }];"
    },
    position: [1200, 300]
  },
  output: [{ served: true }]
});

export default workflow('served-css', 'zz is the new build served (delete)')
  .add(start)
  .to(login)
  .to(links)
  .to(css)
  .to(verdict);
