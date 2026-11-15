const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function background(settings = {}) {
  const state = { settings, domCalls: 0 };
  const event = () => ({ addListener() {} });
  const chrome = {
    storage: { local: {
      async get() { return { settings: state.settings }; },
      async set(value) { state.settings = value.settings; },
    } },
    webRequest: { onHeadersReceived: { addListener(fn) { state.headers = fn; } } },
    downloads: { onCreated: event() },
    runtime: { onInstalled: event(), onMessage: event() },
    contextMenus: { onClicked: event() },
    tabs: { onRemoved: event(), onUpdated: event(),
      sendMessage(id, message, callback) {
        state.domCalls++;
        callback({ resources: [{ url: 'https://example.com/dom.mp4' }] });
      },
    },
  };
  const context = vm.createContext({ chrome, console, URL });
  vm.runInContext(fs.readFileSync(__dirname + '/background.js', 'utf8'), context);
  state.run = code => vm.runInContext(code, context);
  state.sniff = () => state.headers({ tabId: 1, url: 'https://example.com/file.zip',
    responseHeaders: [{ name: 'Content-Type', value: 'application/zip' }] });
  return state;
}

test('default settings collect network and DOM resources', async () => {
  const bg = background();
  await bg.sniff();
  assert.equal((await bg.run('collectResources(1)')).length, 2);
  assert.equal(bg.domCalls, 1);
});

for (const settings of [{ sniff: false }, { enabled: false }]) {
  test('disabled collection skips network and DOM: ' + JSON.stringify(settings), async () => {
    const bg = background(settings);
    await bg.sniff();
    assert.equal(bg.run('sniffByUrl.size'), 0);
    assert.equal((await bg.run('collectResources(1)')).length, 0);
    assert.equal(bg.domCalls, 0);
  });
}

test('disabling sniff clears old resources and re-enabling resumes collection', async () => {
  const bg = background();
  await bg.sniff();
  await bg.run('setSettings({ sniff: false })');
  assert.equal(bg.run('sniffByUrl.size'), 0);
  assert.equal(bg.run('tabResources.size'), 0);
  await bg.run('setSettings({ sniff: true })');
  await bg.sniff();
  assert.equal((await bg.run('collectResources(1)')).length, 2);
});
