// Subdomain routing (v0.1.10): apps that live on a subdomain per
// customer or per language must resolve to their DB key — a real Slack
// workspace is yourteam.slack.com, not slack.com. YouTube Studio is a
// different app from YouTube, so it gets its own DB entry instead of
// borrowing YouTube's shortcuts. outlook.office.com is Outlook, NOT
// office.com — the allowlist must not misfire there.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('./fake-dom');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const docListeners = {};
const winListeners = {};
const docEl = new El('html');
global.document = {
  createElement: (t) => new El(t),
  createDocumentFragment: () => new El('#frag'),
  documentElement: docEl,
  addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); },
  removeEventListener: (t, f) => {
    docListeners[t] = (docListeners[t] || []).filter((x) => x !== f);
  },
};
function fireDoc(type, ev) {
  ev.preventDefault = () => {};
  ev.stopImmediatePropagation = () => {};
  ev.stopPropagation = () => {};
  (docListeners[type] || []).forEach((f) => f(ev));
}
global.window = {
  innerWidth: 1200,
  innerHeight: 800,
  location: {
    hostname: 'acme.slack.com',
    pathname: '/',
    origin: 'https://acme.slack.com',
  },
  addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
  removeEventListener: (t, f) => {
    winListeners[t] = (winListeners[t] || []).filter((x) => x !== f);
  },
};
global.window.top = global.window; // top frame
global.location = global.window.location;
const DB = {
  'slack.com': { shortcuts: [
    { keys: 'Ctrl + K', label: 'Quick switcher', priority: 1 },
  ] },
  'wikipedia.org': { shortcuts: [
    { keys: 'Alt + Shift + X', label: 'Random article', priority: 1 },
  ] },
  'hubspot.com': { shortcuts: [
    { keys: 'Ctrl + K', label: 'Search HubSpot', priority: 1 },
  ] },
  'studio.youtube.com': { shortcuts: [
    { keys: 'K / Space', label: 'Play / Pause', priority: 1 },
  ] },
  'outlook.com': { shortcuts: [
    { keys: 'Ctrl + N', label: 'New mail', priority: 1 },
  ] },
  'office.com': { shortcuts: [
    { keys: 'Ctrl + O', label: 'Open file', priority: 1 },
  ] },
  'amazon.com': { shortcuts: [
    { keys: '/', label: 'Search Amazon', priority: 1 },
  ] },
  'salesforce.com': { shortcuts: [
    { keys: 'Ctrl + K', label: 'Search Salesforce', priority: 1 },
  ] },
  'asana.com': { shortcuts: [
    { keys: 'Tab + Q', label: 'Add task', priority: 1 },
  ] },
  'monday.com': { shortcuts: [
    { keys: 'Ctrl + B', label: 'Search boards', priority: 1 },
  ] },
  'clickup.com': { shortcuts: [
    { keys: 'Q', label: 'Quick create', priority: 1 },
  ] },
  'basecamp.com': { shortcuts: [
    { keys: 'G then P', label: 'Go to projects', priority: 1 },
  ] },
  'shopify.com': { shortcuts: [
    { keys: 'G then H', label: 'Go to home', priority: 1 },
  ] },
  'proton.me': { shortcuts: [
    { keys: 'C', label: 'Compose mail', priority: 1 },
  ] },
  'chatgpt.com': { shortcuts: [
    { keys: 'Ctrl + Shift + O', label: 'New chat', priority: 1 },
  ] },
  'reddit.com': { shortcuts: [
    { keys: 'J', label: 'Next post', priority: 1 },
  ] },
  'github.com': { shortcuts: [
    { keys: 'G then D', label: 'Go to dashboard', priority: 1 },
  ] },
  'zoom.us': { shortcuts: [
    { keys: 'Alt + A', label: 'Mute / Unmute', priority: 1 },
  ] },
  'notion.so': { shortcuts: [
    { keys: 'Ctrl + P', label: 'Quick find', priority: 1 },
  ] },
  'codepen.io': { shortcuts: [
    { keys: 'Ctrl + Shift + 5', label: 'Run pen', priority: 1 },
  ] },
  'discord.com': { shortcuts: [
    { keys: 'Ctrl + K', label: 'Quick switcher', priority: 1 },
  ] },
  'office.com': { shortcuts: [
    { keys: 'Ctrl + O', label: 'Open file', priority: 1 },
  ] },
};
global.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://x/${p}`,
    sendMessage: (_msg, cb) => { setTimeout(() => cb(DB), 0); },
  },
  storage: { sync: { get: (d, cb) => cb({ ...d }) }, onChanged: { addListener() {} } },
};
global.fetch = async () => ({ json: async () => DB });

eval(src);

async function holdCtrl() {
  fireDoc('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
  await sleep(650); // long-press is 500 ms
  fireDoc('keyup', { key: 'Control', code: 'ControlLeft' }); // release trigger opens it
  await sleep(50);
}
function panelAndText() {
  const host = docEl.children.find((c) => c.tagName === 'DIV');
  const panel = host._shadow.children.find((c) => c.classList.contains('panel'));
  return { panel, text: panel.textContent };
}
async function openOn(hostname) {
  fireDoc('keydown', { key: 'Escape', code: 'Escape' });
  await sleep(50);
  global.window.location.hostname = hostname;
  await holdCtrl();
  return panelAndText();
}

test('Slack workspace subdomain shows Slack shortcuts', async () => {
  await sleep(20); // let the DB load via the worker path
  const { panel, text } = await openOn('acme.slack.com');
  assert.ok(panel.classList.contains('visible'), 'panel should be visible');
  assert.ok(text.includes('SLACK.COM'), 'section should be titled SLACK.COM');
  assert.ok(text.includes('Quick switcher'), 'Slack shortcuts should be shown');
});

test('other-language Wikipedia shows Wikipedia shortcuts', async () => {
  const { text } = await openOn('fr.wikipedia.org');
  assert.ok(text.includes('WIKIPEDIA.ORG'), 'section should be titled WIKIPEDIA.ORG');
  assert.ok(text.includes('Random article'), 'Wikipedia shortcuts should be shown');
});

test('HubSpot app subdomain shows HubSpot shortcuts', async () => {
  const { text } = await openOn('app.hubspot.com');
  assert.ok(text.includes('HUBSPOT.COM'), 'section should be titled HUBSPOT.COM');
  assert.ok(text.includes('Search HubSpot'), 'HubSpot shortcuts should be shown');
});

test('YouTube Studio shows its own shortcuts, not YouTube watch ones', async () => {
  const { text } = await openOn('studio.youtube.com');
  assert.ok(text.includes('STUDIO.YOUTUBE.COM'), 'section should be titled STUDIO.YOUTUBE.COM');
  assert.ok(text.includes('Play / Pause'), 'Studio shortcuts should be shown');
});

test('outlook.office.com is Outlook, not Office', async () => {
  const { text } = await openOn('outlook.office.com');
  assert.ok(text.includes('OUTLOOK.COM'), 'section should be titled OUTLOOK.COM');
  assert.ok(text.includes('New mail'), 'Outlook shortcuts should be shown');
  assert.ok(!text.includes('OFFICE.COM'), 'Office shortcuts must not leak into Outlook');
  assert.ok(!text.includes('Open file'), 'Office shortcut must not appear');
});

test('regional Amazon store shows Amazon shortcuts', async () => {
  const { text } = await openOn('amazon.in');
  assert.ok(text.includes('AMAZON.COM'), 'section should be titled AMAZON.COM');
  assert.ok(text.includes('Search Amazon'), 'Amazon shortcuts should be shown');
});

test('Salesforce instance subdomain shows Salesforce shortcuts', async () => {
  const { text } = await openOn('mycompany.my.salesforce.com');
  assert.ok(text.includes('SALESFORCE.COM'), 'section should be titled SALESFORCE.COM');
  assert.ok(text.includes('Search Salesforce'), 'Salesforce shortcuts should be shown');
});

test('unknown host falls back to itself without crashing', async () => {
  const { panel, text } = await openOn('example.com');
  assert.ok(panel.classList.contains('visible'), 'panel should be visible');
  // No DB entry for example.com, so no site section is built — only the
  // global Chrome section. The point is no crash and no other site's
  // shortcuts leaking in.
  assert.ok(text.includes('New tab'), 'global Chrome shortcuts should still be shown');
  assert.ok(!text.includes('Quick switcher'), 'no other site shortcuts must leak in');
  assert.ok(!text.includes('SLACK.COM'), 'no site section should appear for an unknown host');
});

test('v0.1.11 routes: Asana, Monday, ClickUp, Basecamp, Shopify admin, Discord, Microsoft 365 cloud apps', async () => {
  const cases = [
    ['app.asana.com', 'ASANA.COM', 'Add task'],
    ['acme.monday.com', 'MONDAY.COM', 'Search boards'],
    ['app.clickup.com', 'CLICKUP.COM', 'Quick create'],
    ['3.basecamp.com', 'BASECAMP.COM', 'Go to projects'],
    ['admin.shopify.com', 'SHOPIFY.COM', 'Go to home'],
    ['canary.discord.com', 'DISCORD.COM', 'Quick switcher'],
    ['word.cloud.microsoft', 'OFFICE.COM', 'Open file'],
  ];
  for (const [host, title, label] of cases) {
    const { text } = await openOn(host);
    assert.ok(text.includes(title), `${host} should resolve to ${title}`);
    assert.ok(text.includes(label), `${host} should show ${label}`);
  }
});

test('v0.1.11 aliases: Outlook Live, Proton Mail, legacy ChatGPT, old Reddit, Gist, Zoom app, Notion public pages, CodePen full view', async () => {
  const cases = [
    ['outlook.live.com', 'OUTLOOK.COM', 'New mail'],
    ['mail.proton.me', 'PROTON.ME', 'Compose mail'],
    ['chat.openai.com', 'CHATGPT.COM', 'New chat'],
    ['old.reddit.com', 'REDDIT.COM', 'Next post'],
    ['gist.github.com', 'GITHUB.COM', 'Go to dashboard'],
    ['app.zoom.us', 'ZOOM.US', 'Mute / Unmute'],
    ['notion.site', 'NOTION.SO', 'Quick find'],
    ['cdpn.io', 'CODEPEN.IO', 'Run pen'],
  ];
  for (const [host, title, label] of cases) {
    const { text } = await openOn(host);
    assert.ok(text.includes(title), `${host} should resolve to ${title}`);
    assert.ok(text.includes(label), `${host} should show ${label}`);
  }
});

test('content.js, popup.js and options.js carry the same routing tables', () => {
  const expectedRoutes = [
    ['.slack.com', 'slack.com'],
    ['.zendesk.com', 'zendesk.com'],
    ['.freshdesk.com', 'freshdesk.com'],
    ['.salesforce.com', 'salesforce.com'],
    ['.lightning.force.com', 'salesforce.com'],
    ['.my.salesforce.com', 'salesforce.com'],
    ['.hubspot.com', 'hubspot.com'],
    ['.atlassian.net', 'atlassian.net'],
    ['.wikipedia.org', 'wikipedia.org'],
    ['.myshopify.com', 'shopify.com'],
    // v0.1.11
    ['.asana.com', 'asana.com'],
    ['.monday.com', 'monday.com'],
    ['.clickup.com', 'clickup.com'],
    ['.basecamp.com', 'basecamp.com'],
    ['.shopify.com', 'shopify.com'],
    ['.discord.com', 'discord.com'],
    ['.cloud.microsoft', 'office.com'],
  ];
  const expectedAliases = [
    ['outlook.office.com', 'outlook.com'],
    ['amazon.in', 'amazon.com'],
    ['amazon.co.uk', 'amazon.com'],
    ['amazon.de', 'amazon.com'],
    ['amazon.ca', 'amazon.com'],
    ['amazon.com.au', 'amazon.com'],
    ['amazon.co.jp', 'amazon.com'],
    // v0.1.11
    ['outlook.live.com', 'outlook.com'],
    ['mail.proton.me', 'proton.me'],
    ['chat.openai.com', 'chatgpt.com'],
    ['old.reddit.com', 'reddit.com'],
    ['gist.github.com', 'github.com'],
    ['app.zoom.us', 'zoom.us'],
    ['notion.site', 'notion.so'],
    ['cdpn.io', 'codepen.io'],
  ];
  for (const file of ['content.js', 'popup.js', 'options.js']) {
    const fileSrc = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [from, to] of [...expectedRoutes, ...expectedAliases]) {
      assert.ok(
        fileSrc.includes(`"${from}": "${to}"`),
        `${file} is missing the routing ${from} -> ${to}`
      );
    }
  }
});
