import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export class VisualizerPanel {
  public static currentPanel: VisualizerPanel | undefined;
  private static readonly viewType = "inkVisualizer";
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private client: LanguageClient;

  public static createOrShow(
    extensionUri: vscode.Uri,
    client: LanguageClient
  ) {
    const column = vscode.ViewColumn.Beside;

    if (VisualizerPanel.currentPanel) {
      VisualizerPanel.currentPanel.panel.reveal(column);
      VisualizerPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VisualizerPanel.viewType,
      "Ink Branch Visualizer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    VisualizerPanel.currentPanel = new VisualizerPanel(
      panel,
      extensionUri,
      client
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client: LanguageClient
  ) {
    this.panel = panel;
    this.client = client;
    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Refresh on file change
    const watcher = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "ink") {
        setTimeout(() => this.refresh(), 500);
      }
    });
    this.disposables.push(watcher);

    // Initial load
    setTimeout(() => this.refresh(), 300);
  }

  private async refresh() {
    try {
      const graph: any = await this.client.sendRequest("ink/getGraph");
      this.panel.webview.postMessage({ type: "graph", data: graph });
    } catch (e: any) {
      this.panel.webview.postMessage({
        type: "error",
        message: e?.message || String(e),
      });
    }
  }

  private async handleMessage(message: any) {
    switch (message.type) {
      case "refresh":
        this.refresh();
        break;
      case "navigateToKnot":
        await this.navigateToKnot(message.knot);
        break;
      case "exportSvg":
        await this.exportSvg(message.svg);
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

  private async exportSvg(svgContent: string) {
    const uri = await vscode.window.showSaveDialog({
      filters: { "SVG Image": ["svg"] },
      defaultUri: vscode.Uri.file("ink-story-graph.svg"),
    });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(svgContent, "utf8"));
      vscode.window.showInformationMessage(`Graph exported to ${uri.fsPath}`);
    }
  }

  private dispose() {
    VisualizerPanel.currentPanel = undefined;
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
    --node-bg: var(--vscode-badge-background);
    --node-fg: var(--vscode-badge-foreground);
    --dead-bg: var(--vscode-inputValidation-errorBackground);
    --dead-border: var(--vscode-inputValidation-errorBorder);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 13px;
    color: var(--fg);
    background: var(--bg);
    overflow: hidden;
    height: 100vh;
  }
  #toolbar {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    align-items: center;
  }
  button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    border-radius: 2px;
    font-size: 12px;
  }
  button:hover { background: var(--btn-hover); }
  #legend {
    margin-left: auto;
    display: flex;
    gap: 12px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot {
    width: 10px; height: 10px; border-radius: 50%;
    display: inline-block;
  }
  #canvas-container {
    width: 100%;
    height: calc(100vh - 45px);
    overflow: auto;
    cursor: grab;
  }
  #canvas-container:active { cursor: grabbing; }
  svg {
    min-width: 100%;
    min-height: 100%;
  }
  .node rect {
    rx: 6; ry: 6;
    stroke-width: 2;
    cursor: pointer;
    transition: filter 0.15s;
  }
  .node rect:hover { filter: brightness(1.2); }
  .node text {
    font-size: 12px;
    font-family: var(--vscode-editor-font-family, monospace);
    cursor: pointer;
  }
  .node.dead rect {
    stroke: #e74c3c;
    stroke-dasharray: 5,3;
  }
  .node.function rect {
    rx: 12; ry: 12;
  }
  .edgePath path {
    stroke-width: 1.5;
    fill: none;
  }
  .edgeLabel text {
    font-size: 10px;
  }
  #info-panel {
    position: fixed;
    bottom: 12px;
    left: 12px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--border);
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    display: none;
    max-width: 300px;
  }
  .error {
    color: var(--vscode-errorForeground);
    padding: 20px;
    text-align: center;
  }
  .loading {
    color: var(--vscode-descriptionForeground);
    padding: 40px;
    text-align: center;
  }
</style>
</head>
<body>
  <div id="toolbar">
    <button onclick="refresh()">Refresh</button>
    <button onclick="zoomIn()">Zoom +</button>
    <button onclick="zoomOut()">Zoom -</button>
    <button onclick="resetZoom()">Fit</button>
    <button onclick="exportSvg()">Export SVG</button>
    <div id="legend">
      <span class="legend-item"><span class="legend-dot" style="background:#3498db"></span> Knot</span>
      <span class="legend-item"><span class="legend-dot" style="background:#2ecc71"></span> Function</span>
      <span class="legend-item"><span class="legend-dot" style="background:#e74c3c;opacity:0.5"></span> Dead Code</span>
    </div>
  </div>
  <div id="canvas-container">
    <div class="loading" id="loading">Loading graph...</div>
  </div>
  <div id="info-panel"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentZoom = 1;
    let graphData = null;

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'graph':
          graphData = msg.data;
          renderGraph(msg.data);
          break;
        case 'error':
          document.getElementById('canvas-container').innerHTML =
            '<div class="error">Error: ' + escapeHtml(msg.message) + '</div>';
          break;
      }
    });

    function renderGraph(graph) {
      if (!graph || !graph.nodes || graph.nodes.length === 0) {
        document.getElementById('canvas-container').innerHTML =
          '<div class="loading">No knots found in the current file.</div>';
        return;
      }

      const nodeWidth = 140;
      const nodeHeight = 50;
      const horizontalSpacing = 60;
      const verticalSpacing = 80;

      // Topological sort with levels
      const nodeMap = new Map();
      graph.nodes.forEach((n, i) => { nodeMap.set(n.id, { ...n, index: i }); });

      const adjacency = new Map();
      const inDegree = new Map();
      graph.nodes.forEach(n => {
        adjacency.set(n.id, []);
        inDegree.set(n.id, 0);
      });
      graph.edges.forEach(e => {
        if (adjacency.has(e.from) && nodeMap.has(e.to)) {
          adjacency.get(e.from).push(e.to);
          inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
        }
      });

      // BFS layering
      const layers = [];
      const visited = new Set();
      let queue = [];

      // Start with nodes that have no incoming edges
      graph.nodes.forEach(n => {
        if ((inDegree.get(n.id) || 0) === 0) {
          queue.push(n.id);
        }
      });
      if (queue.length === 0 && graph.nodes.length > 0) {
        queue.push(graph.nodes[0].id);
      }

      while (queue.length > 0) {
        layers.push([...queue]);
        queue.forEach(id => visited.add(id));
        const nextQueue = [];
        for (const id of queue) {
          for (const target of (adjacency.get(id) || [])) {
            if (!visited.has(target) && !nextQueue.includes(target)) {
              nextQueue.push(target);
            }
          }
        }
        queue = nextQueue;
      }

      // Add unvisited nodes
      graph.nodes.forEach(n => {
        if (!visited.has(n.id)) {
          layers.push([n.id]);
          visited.add(n.id);
        }
      });

      // Position nodes
      const positions = new Map();
      let maxLayerWidth = 0;
      layers.forEach((layer, layerIdx) => {
        maxLayerWidth = Math.max(maxLayerWidth, layer.length);
        layer.forEach((nodeId, nodeIdx) => {
          const x = nodeIdx * (nodeWidth + horizontalSpacing) +
            (maxLayerWidth - layer.length) * (nodeWidth + horizontalSpacing) / 2;
          const y = layerIdx * (nodeHeight + verticalSpacing);
          positions.set(nodeId, { x: x + 40, y: y + 40 });
        });
      });

      const totalWidth = Math.max(800, maxLayerWidth * (nodeWidth + horizontalSpacing) + 80);
      const totalHeight = Math.max(600, layers.length * (nodeHeight + verticalSpacing) + 80);

      // Build SVG
      let svg = '<svg xmlns="http://www.w3.org/2000/svg" id="graph-svg" ';
      svg += 'width="' + totalWidth + '" height="' + totalHeight + '" ';
      svg += 'viewBox="0 0 ' + totalWidth + ' ' + totalHeight + '">';

      // Defs for arrows
      svg += '<defs>';
      svg += '<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">';
      svg += '<polygon points="0 0, 10 3.5, 0 7" fill="' + getCssVar('--accent', '#3498db') + '" />';
      svg += '</marker>';
      svg += '<marker id="arrowhead-dead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">';
      svg += '<polygon points="0 0, 10 3.5, 0 7" fill="#e74c3c" />';
      svg += '</marker>';
      svg += '</defs>';

      // Draw edges
      graph.edges.forEach(edge => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return;

        const fromNode = nodeMap.get(edge.from);
        const toNode = nodeMap.get(edge.to);
        const isDead = toNode && toNode.isDeadCode;

        const x1 = from.x + nodeWidth / 2;
        const y1 = from.y + nodeHeight;
        const x2 = to.x + nodeWidth / 2;
        const y2 = to.y;

        const midY = (y1 + y2) / 2;
        const strokeColor = isDead ? '#e74c3c' : getCssVar('--accent', '#3498db');
        const marker = isDead ? 'url(#arrowhead-dead)' : 'url(#arrowhead)';
        const opacity = isDead ? '0.4' : '0.7';

        svg += '<path d="M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + midY + ', ' + x2 + ' ' + midY + ', ' + x2 + ' ' + y2 + '" ';
        svg += 'stroke="' + strokeColor + '" stroke-width="1.5" fill="none" ';
        svg += 'opacity="' + opacity + '" marker-end="' + marker + '" />';
      });

      // Draw nodes
      graph.nodes.forEach(node => {
        const pos = positions.get(node.id);
        if (!pos) return;

        const isFunction = node.kind === 'function';
        const isDead = node.isDeadCode;

        let fill, stroke;
        if (isDead) {
          fill = 'rgba(231,76,60,0.15)';
          stroke = '#e74c3c';
        } else if (isFunction) {
          fill = 'rgba(46,204,113,0.15)';
          stroke = '#2ecc71';
        } else {
          fill = 'rgba(52,152,219,0.15)';
          stroke = '#3498db';
        }

        const rx = isFunction ? 20 : 6;
        const dashArray = isDead ? 'stroke-dasharray="5,3"' : '';

        svg += '<g class="node ' + (isDead ? 'dead ' : '') + (isFunction ? 'function' : '') + '" ';
        svg += 'data-id="' + node.id + '" onclick="onNodeClick(\'' + node.id + '\')" ';
        svg += 'onmouseover="onNodeHover(\'' + node.id + '\')" onmouseout="hideInfo()">';

        svg += '<rect x="' + pos.x + '" y="' + pos.y + '" ';
        svg += 'width="' + nodeWidth + '" height="' + nodeHeight + '" ';
        svg += 'rx="' + rx + '" ry="' + rx + '" ';
        svg += 'fill="' + fill + '" stroke="' + stroke + '" stroke-width="2" ' + dashArray + ' />';

        // Truncate name if too long
        let label = node.label;
        if (label.length > 16) label = label.substring(0, 14) + '...';

        svg += '<text x="' + (pos.x + nodeWidth / 2) + '" y="' + (pos.y + nodeHeight / 2 - 4) + '" ';
        svg += 'text-anchor="middle" fill="' + getCssVar('--fg', '#ccc') + '" font-size="12">';
        svg += escapeHtml(label) + '</text>';

        // Word count / choice count
        svg += '<text x="' + (pos.x + nodeWidth / 2) + '" y="' + (pos.y + nodeHeight / 2 + 14) + '" ';
        svg += 'text-anchor="middle" fill="' + getCssVar('--vscode-descriptionForeground', '#888') + '" font-size="10">';
        svg += node.wordCount + 'w / ' + node.choiceCount + 'c</text>';

        svg += '</g>';
      });

      svg += '</svg>';

      document.getElementById('canvas-container').innerHTML = svg;
    }

    function onNodeClick(nodeId) {
      vscode.postMessage({ type: 'navigateToKnot', knot: nodeId });
    }

    function onNodeHover(nodeId) {
      if (!graphData) return;
      const node = graphData.nodes.find(n => n.id === nodeId);
      if (!node) return;

      const inEdges = graphData.edges.filter(e => e.to === nodeId).length;
      const outEdges = graphData.edges.filter(e => e.from === nodeId).length;

      const info = document.getElementById('info-panel');
      info.innerHTML = '<strong>' + escapeHtml(node.label) + '</strong><br>' +
        'Words: ' + node.wordCount + '<br>' +
        'Choices: ' + node.choiceCount + '<br>' +
        'Incoming: ' + inEdges + ' | Outgoing: ' + outEdges +
        (node.isDeadCode ? '<br><span style="color:#e74c3c">Unreachable</span>' : '');
      info.style.display = 'block';
    }

    function hideInfo() {
      document.getElementById('info-panel').style.display = 'none';
    }

    function refresh() {
      document.getElementById('canvas-container').innerHTML =
        '<div class="loading">Loading graph...</div>';
      vscode.postMessage({ type: 'refresh' });
    }

    function zoomIn() {
      currentZoom = Math.min(currentZoom * 1.25, 3);
      applyZoom();
    }

    function zoomOut() {
      currentZoom = Math.max(currentZoom * 0.8, 0.2);
      applyZoom();
    }

    function resetZoom() {
      currentZoom = 1;
      applyZoom();
    }

    function applyZoom() {
      const svg = document.querySelector('#graph-svg');
      if (svg) {
        svg.style.transform = 'scale(' + currentZoom + ')';
        svg.style.transformOrigin = 'top left';
      }
    }

    function exportSvg() {
      const svg = document.getElementById('graph-svg');
      if (svg) {
        vscode.postMessage({ type: 'exportSvg', svg: svg.outerHTML });
      }
    }

    function getCssVar(name, fallback) {
      try {
        const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return val || fallback;
      } catch { return fallback; }
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
