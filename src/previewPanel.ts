import { attachPanelPersistence, restorePanelState } from "./panelPersistence";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export class PreviewPanel {
  public static currentPanel: PreviewPanel | undefined;
  private static readonly viewType = "inkPreview";
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private documentUri: string = "";
  private story: any = null;
  private rewindHistory: { state: string; view: any }[] = [];
  private previewOutput: { text: string; tags: string[]; kind?: string }[] = [];
  private previewView: any = null;

  private clearHistory() {
    this.rewindHistory = [];
    this.previewOutput = [];
    this.previewView = null;
    this.panel.webview.postMessage({ type: "clear" });
  }

  private rewindStory() {
    if (!this.story || !this.rewindHistory.length) return;
    const snapshot = this.rewindHistory[this.rewindHistory.length - 1];
    try {
      this.story.state.LoadJson(snapshot.state);
      this.rewindHistory.pop();
      this.previewView = snapshot.view;
      this.previewOutput = snapshot.view.output;
      this.panel.webview.postMessage({
        ...this.previewView, replaceOutput: false, output: [],
        truncateOutput: this.previewOutput.length, canRewind: this.rewindHistory.length > 0,
      });
    } catch (error: any) {
      this.panel.webview.postMessage({ type: "error", message: error?.message || String(error) });
    }
  }


  public static createOrShow(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument,
    client: LanguageClient
  ) {
    const column = vscode.ViewColumn.Beside;

    if (PreviewPanel.currentPanel) {
      PreviewPanel.currentPanel.panel.reveal(column);
      PreviewPanel.currentPanel.loadStory(document);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      "Ink Preview",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    PreviewPanel.currentPanel = new PreviewPanel(panel, extensionUri);
    PreviewPanel.currentPanel.loadStory(document);
  }

  public static restart() {
    if (PreviewPanel.currentPanel) {
      PreviewPanel.currentPanel.restartStory();
    }
  }

  public static onDocumentSaved(
    document: vscode.TextDocument,
    client: LanguageClient
  ) {
    if (!PreviewPanel.currentPanel) return;
    const config = vscode.workspace.getConfiguration("ink");
    if (config.get<boolean>("previewAutoUpdate", true)) {
      PreviewPanel.currentPanel.loadStory(document);
    }
  }

  public static registerSerializer(context: vscode.ExtensionContext, client: LanguageClient) {
    const extensionUri = context.extensionUri;
    context.subscriptions.push(vscode.window.registerWebviewPanelSerializer(PreviewPanel.viewType, {
      async deserializeWebviewPanel(panel, state) {
        panel.webview.options = { ...panel.webview.options, enableScripts: true };
        const restored = new PreviewPanel(panel, extensionUri);
        PreviewPanel.currentPanel = restored;
        restorePanelState(restored, state);
      }
    }));
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    attachPanelPersistence(this);
    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async loadStory(document: vscode.TextDocument) {
    this.documentUri = document.uri.toString();
    const text = document.getText();

    try {
      const { Compiler } = require("inkjs/compiler/Compiler");
      const compiler = new Compiler(text);
      this.story = compiler.Compile();

      // Bind external functions as stubs
      if (this.story.listDefinitions) {
        // Story compiled successfully
      }

      this.restartStory();
    } catch (e: any) {
      this.panel.webview.postMessage({
        type: "error",
        message: e?.message || String(e),
      });
    }
  }

  private restartStory() {
    if (!this.story) return;

    try {
      this.story.ResetState();
      this.clearHistory();
      this.continueStory();
    } catch (e: any) {
      this.panel.webview.postMessage({
        type: "error",
        message: e?.message || String(e),
      });
    }
  }

  private continueStory(highlightChoice = false) {
    if (!this.story) return;

    try {
      const output: { text: string; tags: string[]; kind?: string }[] = [];

      while (this.story.canContinue) {
        const text = this.story.Continue();
        const tags = this.story.currentTags || [];
        if (text) {
          const line = text.trim();
          output.push({ text: line, tags, ...(highlightChoice && line ? { kind: "selected-choice" } : {}) });
          if (line) highlightChoice = false;
        }
      }

      const choices = this.story.currentChoices.map(
        (c: any, i: number) => ({
          index: i,
          text: c.text,
        })
      );

      // Get variable state
      const variables: { name: string; value: any }[] = [];
      try {
        const varState = this.story.variablesState;
        if (varState) {
          for (const name of Object.keys(varState).sort()) {
            const value = varState.$(name);
            variables.push({ name, value: value === null ? "null" : String(value) });
          }
        }
      } catch {
        // Variable enumeration may not be available in all inkjs versions
      }

      // Current path info
      let currentKnot = "";
      try {
        const currentPath = this.story.state?.currentPathString;
        if (currentPath) {
          currentKnot = currentPath.split(".")[0];
        }
      } catch {
        // Path access may fail
      }

      this.previewOutput = this.previewOutput.concat(output);
      this.previewView = {
        type: "story", replaceOutput: true, output: this.previewOutput,
        choices, variables, currentKnot,
        canContinue: this.story.canContinue,
        isEnd: choices.length === 0 && !this.story.canContinue,
      };
      this.panel.webview.postMessage({
        ...this.previewView, replaceOutput: false, output,
        canRewind: this.rewindHistory.length > 0,
      });
    } catch (e: any) {
      this.panel.webview.postMessage({
        type: "error",
        message: e?.message || String(e),
      });
    }
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case "choice":
        if (this.story) {
          try {
            if (!Number.isInteger(message.index) || message.index < 0 || message.index >= this.story.currentChoices.length) return;
            this.rewindHistory.push({ state: this.story.state.ToJson(), view: this.previewView });
            const choice = this.story.currentChoices[message.index];
            const point = this.story.ContentAtPath(new choice.targetPath.constructor(choice.sourcePath)).obj;
            // Only Ink's actual output is displayed; [choice-only] text stays suppressed.
            const highlightChoice = !!point?.hasStartContent;
            this.story.ChooseChoiceIndex(message.index);
            this.continueStory(highlightChoice);
          } catch (e: any) {
            this.panel.webview.postMessage({
              type: "error",
              message: e?.message || String(e),
            });
          }
        }
        break;
      case "rewind":
        this.rewindStory();
        break;
      case "restart":
        this.restartStory();
        break;
      case "jumpToKnot":
        if (this.story && message.knot) {
          try {
            this.story.ChoosePathString(message.knot);
            this.clearHistory();
            this.continueStory();
          } catch (e: any) {
            this.panel.webview.postMessage({
              type: "error",
              message: `Cannot jump to '${message.knot}': ${e?.message}`,
            });
          }
        }
        break;
      case "goToSource":
        // Navigate to knot in editor
        if (message.knot) {
          this.navigateToKnot(message.knot);
        }
        break;
    }
  }

  private async navigateToKnot(knotName: string) {
    const files = await vscode.workspace.findFiles("**/*.ink");
    for (const file of files) {
      const doc = await vscode.workspace.openTextDocument(file);
      const text = doc.getText();
      const re = new RegExp(`^===\\s*(?:function\\s+)?${knotName}\\s*`, "m");
      const match = re.exec(text);
      if (match) {
        const pos = doc.positionAt(match.index);
        const editor = await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
        });
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter
        );
        return;
      }
    }
  }

  private dispose() {
    PreviewPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }

  private getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --accent: var(--vscode-textLink-foreground);
    --border: var(--vscode-panel-border);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --error-fg: var(--vscode-errorForeground);
    --choice-bg: var(--vscode-list-hoverBackground);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 14px);
    color: var(--fg);
    background: var(--bg);
    padding: 16px;
    line-height: 1.6;
  }
  #toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
    align-items: center;
    flex-wrap: wrap;
  }
  button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    padding: 4px 12px;
    cursor: pointer;
    border-radius: 2px;
    font-size: 12px;
  }
  button:hover { background: var(--btn-hover); }
  button:disabled { opacity: 0.45; cursor: default; }
  #jump-input {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    padding: 4px 8px;
    font-size: 12px;
    border-radius: 2px;
    width: 150px;
  }
  #story-output {
    margin-bottom: 16px;
    max-height: 60vh;
    overflow-y: auto;
    padding-right: 8px;
  }
  .text-line {
    margin-bottom: 8px;
    animation: fadeIn 0.3s ease-in;
  }
  .text-line.selected-choice {
    color: var(--vscode-textLink-foreground);
    font-weight: 600;
    border-left: 3px solid var(--vscode-textLink-foreground);
    background: var(--vscode-textBlockQuote-background, transparent);
    padding: 6px 10px;
    margin: 12px 0 8px;
    white-space: pre-wrap;
  }
  .text-line .tags {
    color: var(--vscode-descriptionForeground);
    font-size: 0.85em;
    font-style: italic;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  #choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }
  .choice-btn {
    background: var(--choice-bg);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 8px 12px;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s;
  }
  .choice-btn:hover {
    background: var(--btn-bg);
    color: var(--btn-fg);
  }
  .choice-number {
    color: var(--accent);
    font-weight: bold;
    margin-right: 8px;
  }
  #end-marker {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    margin-top: 16px;
    text-align: center;
  }
  .error {
    color: var(--error-fg);
    background: var(--vscode-inputValidation-errorBackground);
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 12px;
  }
  #variables-panel {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  #variables-panel summary {
    cursor: pointer;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
  .var-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    font-size: 12px;
  }
  .var-table td {
    padding: 2px 8px;
    border-bottom: 1px solid var(--border);
  }
  .var-table td:first-child {
    color: var(--accent);
    font-family: var(--vscode-editor-font-family, monospace);
  }
  #current-knot {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    cursor: pointer;
  }
  #current-knot:hover { color: var(--accent); }
</style>
</head>
<body>
  <div id="toolbar">
    <button onclick="restart()">Restart</button>
    <button id="rewind-button" onclick="rewind()" title="Return to the previous choice" disabled>Rewind</button>
    <input id="jump-input" type="text" placeholder="Jump to knot..." />
    <button onclick="jumpToKnot()">Jump</button>
    <span id="current-knot" onclick="goToSource()"></span>
  </div>
  <div id="story-output"></div>
  <div id="choices"></div>
  <div id="end-marker" style="display:none">--- End of story ---</div>
  <div id="variables-panel">
    <details>
      <summary>Variables</summary>
      <table class="var-table" id="var-table"></table>
    </details>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentKnotName = '';

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'story':
          renderStory(msg);
          break;
        case 'error':
          renderError(msg.message);
          break;
        case 'clear':
          document.getElementById('rewind-button').disabled = true;
          document.getElementById('story-output').innerHTML = '';
          document.getElementById('choices').innerHTML = '';
          document.getElementById('end-marker').style.display = 'none';
          break;
      }
    });

    function renderStory(data) {
      const output = document.getElementById('story-output');
      if (data.replaceOutput) output.innerHTML = '';
      if (Number.isInteger(data.truncateOutput)) {
        for (const error of output.querySelectorAll('.error')) error.remove();
        while (output.children.length > data.truncateOutput) {
          output.lastElementChild.remove();
        }
      }
      document.getElementById('rewind-button').disabled = !data.canRewind;
      for (const item of data.output) {
        const div = document.createElement('div');
        const isSelectedChoice = item.kind === 'selected-choice';
        div.className = isSelectedChoice ? 'text-line selected-choice' : 'text-line';
        div.textContent = item.text;
        if (item.tags && item.tags.length > 0) {
          const tagSpan = document.createElement('span');
          tagSpan.className = 'tags';
          tagSpan.textContent = ' [' + item.tags.join(', ') + ']';
          div.appendChild(tagSpan);
        }
        output.appendChild(div);
      }
      output.scrollTop = output.scrollHeight;

      const choicesDiv = document.getElementById('choices');
      choicesDiv.innerHTML = '';
      for (const choice of data.choices) {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.innerHTML = '<span class="choice-number">' + (choice.index + 1) + '.</span>' + escapeHtml(choice.text);
        btn.onclick = () => selectChoice(choice.index);
        choicesDiv.appendChild(btn);
      }

      document.getElementById('end-marker').style.display =
        data.isEnd ? 'block' : 'none';

      // Update variables
      const varTable = document.getElementById('var-table');
      varTable.innerHTML = '';
      for (const v of (data.variables || [])) {
        const row = varTable.insertRow();
        row.insertCell().textContent = v.name;
        row.insertCell().textContent = v.value;
      }

      // Update current knot
      currentKnotName = data.currentKnot || '';
      document.getElementById('current-knot').textContent = '';
      if (data.currentKnot) {
        currentKnotName = data.currentKnot;
        document.getElementById('current-knot').textContent =
          'Current: ' + data.currentKnot;
      }
    }

    function renderError(message) {
      const output = document.getElementById('story-output');
      const div = document.createElement('div');
      div.className = 'error';
      div.textContent = 'Error: ' + message;
      output.appendChild(div);
    }

    function selectChoice(index) {
      vscode.postMessage({ type: 'choice', index });
    }

    function rewind() {
      vscode.postMessage({ type: 'rewind' });
    }

    function restart() {
      document.getElementById('story-output').innerHTML = '';
      document.getElementById('choices').innerHTML = '';
      document.getElementById('end-marker').style.display = 'none';
      vscode.postMessage({ type: 'restart' });
    }

    function jumpToKnot() {
      const input = document.getElementById('jump-input');
      const knot = input.value.trim();
      if (knot) {
        document.getElementById('story-output').innerHTML = '';
        document.getElementById('choices').innerHTML = '';
        vscode.postMessage({ type: 'jumpToKnot', knot });
        input.value = '';
      }
    }

    function goToSource() {
      if (currentKnotName) {
        vscode.postMessage({ type: 'goToSource', knot: currentKnotName });
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    document.getElementById('jump-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') jumpToKnot();
    });

    // Keyboard shortcuts: 1-9 for choices
    document.addEventListener('keypress', (e) => {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        const btns = document.querySelectorAll('.choice-btn');
        if (btns[num - 1]) btns[num - 1].click();
      }
    });

    let inkStoredState = vscode.getState() || {};
    function inkSaveUi() {
      const scroll = {};
      for (const el of document.querySelectorAll('[id]')) {
        if (el.scrollTop || el.scrollLeft) scroll[el.id] = [el.scrollLeft, el.scrollTop];
      }
      inkStoredState.ui = {scroll, zoom: typeof currentZoom === 'number' ? currentZoom : undefined};
      vscode.setState(inkStoredState);
    }
    window.addEventListener('message', event => {
      if (event.data.inkSnapshot) {
        inkStoredState.inkSnapshot = event.data.inkSnapshot;
        vscode.setState(inkStoredState);
      }
      if (event.data.inkRestoreUi && inkStoredState.ui) {
        if (typeof currentZoom === 'number' && typeof inkStoredState.ui.zoom === 'number') {
          currentZoom = inkStoredState.ui.zoom;
          applyZoom();
        }
        for (const [id, pos] of Object.entries(inkStoredState.ui.scroll || {})) {
          const el = document.getElementById(id);
          if (el) { el.scrollLeft = pos[0]; el.scrollTop = pos[1]; }
        }
      }
    });
    document.addEventListener('scroll', inkSaveUi, true);
    document.addEventListener('click', inkSaveUi);
    vscode.postMessage({type:'inkReady'});

</script>
</body>
</html>`;
  }
}
