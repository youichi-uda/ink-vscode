import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

// Matches SymbolKind from inkService.ts
type InkSymbolKind =
  | "knot"
  | "stitch"
  | "function"
  | "variable"
  | "constant"
  | "temp"
  | "list"
  | "external"
  | "label"
  | "include";

interface InkSymbol {
  name: string;
  kind: InkSymbolKind;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  detail?: string;
  children?: InkSymbol[];
  params?: string[];
  uri?: string;
}

// --- Tree Items ---

class StoryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly symbol: InkSymbol,
    public readonly collapsible: vscode.TreeItemCollapsibleState,
    public readonly fileUri: string
  ) {
    super(label, collapsible);

    this.description = symbol.detail || "";
    this.tooltip = `${kindLabel(symbol.kind)}: ${symbol.name}`;
    this.iconPath = kindIcon(symbol.kind);
    this.contextValue = symbol.kind;

    this.command = {
      command: "ink.sidebar.goToSymbol",
      title: "Go to Symbol",
      arguments: [fileUri, symbol.line, symbol.character],
    };
  }
}

function kindLabel(kind: InkSymbolKind): string {
  const labels: Record<InkSymbolKind, string> = {
    knot: "Knot",
    stitch: "Stitch",
    function: "Function",
    variable: "Variable",
    constant: "Constant",
    temp: "Temp Variable",
    list: "List",
    external: "External",
    label: "Label",
    include: "Include",
  };
  return labels[kind] || kind;
}

function kindIcon(kind: InkSymbolKind): vscode.ThemeIcon {
  const icons: Record<InkSymbolKind, string> = {
    knot: "symbol-class",
    stitch: "symbol-method",
    function: "symbol-function",
    variable: "symbol-variable",
    constant: "symbol-constant",
    temp: "symbol-field",
    list: "symbol-enum",
    external: "symbol-interface",
    label: "symbol-key",
    include: "file-code",
  };
  return new vscode.ThemeIcon(icons[kind] || "symbol-misc");
}

// --- Story Outline Provider ---

export class StoryOutlineProvider
  implements vscode.TreeDataProvider<StoryItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    StoryItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private symbols: InkSymbol[] = [];
  private fileUri = "";

  constructor(private client: LanguageClient) {}

  refresh(symbols: InkSymbol[], fileUri: string): void {
    this.symbols = symbols;
    this.fileUri = fileUri;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StoryItem): StoryItem[] {
    if (!element) {
      // Top-level: knots and functions
      return this.symbols
        .filter((s) => s.kind === "knot" || s.kind === "function")
        .map(
          (s) =>
            new StoryItem(
              s.name,
              s,
              s.children && s.children.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
              s.uri || this.fileUri
            )
        );
    }

    // Children: stitches and labels under a knot
    const sym = element.symbol;
    if (sym.children) {
      return sym.children.map(
        (c) =>
          new StoryItem(
            c.name,
            c,
            vscode.TreeItemCollapsibleState.None,
            c.uri || this.fileUri
          )
      );
    }
    return [];
  }
}

// --- Variables Provider ---

export class VariablesProvider
  implements vscode.TreeDataProvider<StoryItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    StoryItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private symbols: InkSymbol[] = [];
  private fileUri = "";

  constructor(private client: LanguageClient) {}

  refresh(symbols: InkSymbol[], fileUri: string): void {
    this.symbols = symbols;
    this.fileUri = fileUri;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StoryItem): StoryItem[] {
    if (element) return [];

    return this.symbols
      .filter(
        (s) =>
          s.kind === "variable" ||
          s.kind === "constant" ||
          s.kind === "list" ||
          s.kind === "external"
      )
      .map(
        (s) =>
          new StoryItem(
            s.name,
            s,
            vscode.TreeItemCollapsibleState.None,
            s.uri || this.fileUri
          )
      );
  }
}

// --- Registration ---

export function registerSidebar(
  context: vscode.ExtensionContext,
  client: LanguageClient
): { outline: StoryOutlineProvider; variables: VariablesProvider } {
  const outline = new StoryOutlineProvider(client);
  const variables = new VariablesProvider(client);

  vscode.window.registerTreeDataProvider("inkStoryOutline", outline);
  vscode.window.registerTreeDataProvider("inkVariables", variables);

  // Navigate to symbol on click
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ink.sidebar.goToSymbol",
      async (fileUri: string, line: number, character: number) => {
        const uri = vscode.Uri.parse(fileUri);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const pos = new vscode.Position(line, character);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter
        );
      }
    )
  );

  // Refresh commands
  context.subscriptions.push(
    vscode.commands.registerCommand("ink.sidebar.refreshOutline", () => {
      updateSidebar(client, outline, variables);
    }),
    vscode.commands.registerCommand("ink.sidebar.refreshVariables", () => {
      updateSidebar(client, outline, variables);
    })
  );

  // Update on editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === "ink") {
        updateSidebar(client, outline, variables);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === "ink") {
        debounceUpdate(client, outline, variables);
      }
    })
  );

  // Initial update
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document.languageId === "ink") {
    updateSidebar(client, outline, variables);
  }

  return { outline, variables };
}

let updateTimer: ReturnType<typeof setTimeout> | undefined;

function debounceUpdate(
  client: LanguageClient,
  outline: StoryOutlineProvider,
  variables: VariablesProvider
): void {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => updateSidebar(client, outline, variables), 500);
}

async function updateSidebar(
  client: LanguageClient,
  outline: StoryOutlineProvider,
  variables: VariablesProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "ink") return;

  try {
    const symbols = await client.sendRequest<InkSymbol[]>(
      "ink/getSymbols",
      { uri: editor.document.uri.toString() }
    );

    const fileUri = editor.document.uri.toString();
    outline.refresh(symbols || [], fileUri);
    variables.refresh(symbols || [], fileUri);
  } catch {
    // LSP not ready yet
  }
}
