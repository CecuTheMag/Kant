import blessed from 'blessed';

export interface UI {
  screen:      blessed.Widgets.Screen;
  contactList: blessed.Widgets.ListElement;
  chatBox:     blessed.Widgets.BoxElement;
  inputBox:    blessed.Widgets.TextboxElement;
  statusBar:   blessed.Widgets.BoxElement;
  logBox:      blessed.Widgets.BoxElement;
  render:      () => void;
}

export function createUI(): UI {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Kant — Encrypted Messenger',
    fullUnicode: true,
  });

  // ── Left panel: contact list ──────────────────────────────────────────────
  const leftPanel = blessed.box({
    parent: screen,
    top: 0, left: 0,
    width: 28, height: '100%-2',
    border: { type: 'line' },
    style: {
      border: { fg: 'blue' },
      label: { fg: 'cyan', bold: true },
    },
    label: ' Kant ',
  });

  const contactList = blessed.list({
    parent: leftPanel,
    top: 0, left: 0,
    width: '100%-2', height: '100%-2',
    keys: true,
    vi: true,
    mouse: true,
    style: {
      selected: { bg: 'blue', fg: 'white', bold: true },
      item: { fg: 'white' },
    },
    scrollbar: { ch: '│', style: { fg: 'blue' } },
  });

  // ── Right panel: chat ─────────────────────────────────────────────────────
  const rightPanel = blessed.box({
    parent: screen,
    top: 0, left: 28,
    width: '100%-28', height: '100%-2',
    border: { type: 'line' },
    style: { border: { fg: 'blue' } },
    label: ' No contact selected ',
  });

  const chatBox = blessed.box({
    parent: rightPanel,
    top: 0, left: 0,
    width: '100%-2', height: '100%-5',
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: '│', style: { fg: 'blue' } },
    tags: true,
    wrap: true,
  });

  const inputBox = blessed.textbox({
    parent: rightPanel,
    bottom: 0, left: 0,
    width: '100%-2', height: 3,
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      focus: { border: { fg: 'green' } },
    },
    label: ' Message ',
    inputOnFocus: true,
  });

  // ── Status bar ────────────────────────────────────────────────────────────
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0, left: 0,
    width: '100%', height: 1,
    style: { bg: 'blue', fg: 'white' },
    tags: true,
    content: ' {bold}Kant{/bold}  ●  Offline  |  Tab: switch panel  Enter: send  Ctrl+C: quit',
  });

  // ── Debug log (hidden by default, toggle with F1) ─────────────────────────
  const logBox = blessed.box({
    parent: screen,
    bottom: 1, right: 0,
    width: 60, height: 12,
    border: { type: 'line' },
    style: { border: { fg: 'yellow' }, bg: 'black' },
    label: ' Debug Log ',
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    hidden: true,
    wrap: true,
  });

  // ── Key bindings ──────────────────────────────────────────────────────────
  screen.key(['C-c', 'q'], () => process.exit(0));

  screen.key(['tab'], () => {
    if (screen.focused === inputBox) {
      contactList.focus();
    } else {
      inputBox.focus();
    }
    screen.render();
  });

  screen.key(['f1'], () => {
    if (logBox.hidden) logBox.show();
    else logBox.hide();
    screen.render();
  });

  contactList.focus();

  return {
    screen,
    contactList,
    chatBox,
    inputBox,
    statusBar,
    logBox,
    render: () => screen.render(),
  };
}

export function appendChat(ui: UI, line: string) {
  const content = (ui.chatBox.getContent() + '\n' + line).trimStart();
  ui.chatBox.setContent(content);
  ui.chatBox.setScrollPerc(100);
  ui.render();
}

export function appendLog(ui: UI, line: string) {
  const ts = new Date().toLocaleTimeString();
  const content = (ui.logBox.getContent() + '\n' + `{yellow-fg}${ts}{/} ${line}`).trimStart();
  ui.logBox.setContent(content);
  ui.logBox.setScrollPerc(100);
  ui.render();
}

export function setStatus(ui: UI, text: string) {
  ui.statusBar.setContent(` {bold}Kant{/bold}  ${text}  |  Tab: switch panel  Enter: send  F1: log  Ctrl+C: quit`);
  ui.render();
}

export function setChatLabel(ui: UI, label: string) {
  (ui.chatBox.parent as any).setLabel(` ${label} `);
  ui.render();
}
