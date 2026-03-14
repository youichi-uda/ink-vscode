import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export class StatisticsPanel {
  public static currentPanel: StatisticsPanel | undefined;
  private static readonly viewType = "inkStatistics";
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private client: LanguageClient;
  private readingSpeed: number;

  public static createOrShow(
    extensionUri: vscode.Uri,
    client: LanguageClient,
    readingSpeed: number
  ) {
    const column = vscode.ViewColumn.Beside;

    if (StatisticsPanel.currentPanel) {
      StatisticsPanel.currentPanel.panel.reveal(column);
      StatisticsPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      StatisticsPanel.viewType,
      "Ink Statistics",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    StatisticsPanel.currentPanel = new StatisticsPanel(
      panel,
      extensionUri,
      client,
      readingSpeed
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client: LanguageClient,
    readingSpeed: number
  ) {
    this.panel = panel;
    this.client = client;
    this.readingSpeed = readingSpeed;
    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    const watcher = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "ink") {
        setTimeout(() => this.refresh(), 500);
      }
    });
    this.disposables.push(watcher);

    setTimeout(() => this.refresh(), 300);
  }

  private async refresh() {
    try {
      const stats: any = await this.client.sendRequest("ink/getStatistics", {
        readingSpeed: this.readingSpeed,
      });
      this.panel.webview.postMessage({ type: "statistics", data: stats });
    } catch (e: any) {
      this.panel.webview.postMessage({
        type: "error",
        message: e?.message || String(e),
      });
    }
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case "refresh":
        this.refresh();
        break;
    }
  }

  private dispose() {
    StatisticsPanel.currentPanel = undefined;
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
    --warn: var(--vscode-editorWarning-foreground);
    --error: var(--vscode-errorForeground);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 13px;
    color: var(--fg);
    background: var(--bg);
    padding: 16px;
    line-height: 1.5;
  }
  h2 {
    font-size: 16px;
    margin-bottom: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  #toolbar {
    margin-bottom: 16px;
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
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  .stat-card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 12px;
    text-align: center;
  }
  .stat-value {
    font-size: 28px;
    font-weight: bold;
    color: var(--accent);
  }
  .stat-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 4px;
  }
  .section {
    margin-bottom: 24px;
  }
  .section h3 {
    font-size: 13px;
    margin-bottom: 8px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th, td {
    padding: 6px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  th {
    color: var(--vscode-descriptionForeground);
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
  }
  .bar-container {
    width: 100%;
    height: 8px;
    background: var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 4px;
    transition: width 0.3s;
  }
  .warning-list {
    list-style: none;
  }
  .warning-list li {
    padding: 4px 0;
    color: var(--warn);
    font-size: 12px;
  }
  .warning-list li::before {
    content: "\\26A0 ";
  }
  .loading {
    text-align: center;
    padding: 40px;
    color: var(--vscode-descriptionForeground);
  }
</style>
</head>
<body>
  <div id="toolbar">
    <button onclick="refresh()">Refresh</button>
  </div>
  <div id="content">
    <div class="loading">Loading statistics...</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'statistics':
          renderStatistics(msg.data);
          break;
        case 'error':
          document.getElementById('content').innerHTML =
            '<div class="loading" style="color:var(--error)">Error: ' + escapeHtml(msg.message) + '</div>';
          break;
      }
    });

    function renderStatistics(stats) {
      let html = '';

      // Overview cards
      html += '<div class="stats-grid">';
      html += statCard(stats.totalWords.toLocaleString(), 'Total Words');
      html += statCard(stats.totalKnots, 'Knots');
      html += statCard(stats.totalStitches, 'Stitches');
      html += statCard(stats.totalChoices, 'Choices');
      html += statCard(stats.totalFunctions, 'Functions');
      html += statCard(stats.totalVariables + stats.totalConstants, 'Variables');
      html += statCard(stats.totalLists, 'Lists');
      html += statCard(stats.totalIncludes, 'Includes');
      html += statCard('~' + stats.estimatedPlaytimeMinutes + 'min', 'Est. Playtime');
      html += '</div>';

      // Knot word counts
      if (stats.knotWordCounts && stats.knotWordCounts.length > 0) {
        html += '<div class="section">';
        html += '<h3>Word Count by Knot</h3>';
        html += '<table>';
        html += '<tr><th>Knot</th><th>Words</th><th></th></tr>';

        const maxWords = Math.max(...stats.knotWordCounts.map(k => k.words), 1);
        for (const knot of stats.knotWordCounts) {
          const pct = (knot.words / maxWords * 100).toFixed(0);
          html += '<tr>';
          html += '<td>' + escapeHtml(knot.name) + '</td>';
          html += '<td>' + knot.words + '</td>';
          html += '<td style="width:40%"><div class="bar-container"><div class="bar-fill" style="width:' + pct + '%"></div></div></td>';
          html += '</tr>';
        }
        html += '</table>';
        html += '</div>';
      }

      // Warnings
      const warnings = [];
      if (stats.deadKnots && stats.deadKnots.length > 0) {
        for (const k of stats.deadKnots) {
          warnings.push('Unreachable knot: <strong>' + escapeHtml(k) + '</strong>');
        }
      }
      if (stats.unusedVariables && stats.unusedVariables.length > 0) {
        for (const v of stats.unusedVariables) {
          warnings.push('Unused variable: <strong>' + escapeHtml(v) + '</strong>');
        }
      }

      if (warnings.length > 0) {
        html += '<div class="section">';
        html += '<h3>Warnings (' + warnings.length + ')</h3>';
        html += '<ul class="warning-list">';
        for (const w of warnings) {
          html += '<li>' + w + '</li>';
        }
        html += '</ul>';
        html += '</div>';
      }

      // Structure summary
      html += '<div class="section">';
      html += '<h3>Structure</h3>';
      html += '<table>';
      html += '<tr><td>Total Diverts</td><td>' + stats.totalDiverts + '</td></tr>';
      html += '<tr><td>Total Gathers</td><td>' + stats.totalGathers + '</td></tr>';
      html += '<tr><td>Avg Words/Knot</td><td>' + (stats.totalKnots > 0 ? Math.round(stats.totalWords / stats.totalKnots) : 0) + '</td></tr>';
      html += '<tr><td>Avg Choices/Knot</td><td>' + (stats.totalKnots > 0 ? (stats.totalChoices / stats.totalKnots).toFixed(1) : 0) + '</td></tr>';
      html += '</table>';
      html += '</div>';

      document.getElementById('content').innerHTML = html;
    }

    function statCard(value, label) {
      return '<div class="stat-card">' +
        '<div class="stat-value">' + value + '</div>' +
        '<div class="stat-label">' + label + '</div>' +
        '</div>';
    }

    function refresh() {
      document.getElementById('content').innerHTML =
        '<div class="loading">Loading statistics...</div>';
      vscode.postMessage({ type: 'refresh' });
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
  }
}
