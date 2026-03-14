import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  DefinitionParams,
  Location,
  ReferenceParams,
  RenameParams,
  WorkspaceEdit,
  TextEdit,
  Hover,
  DocumentSymbolParams,
  SymbolInformation,
  SymbolKind as LSPSymbolKind,
  Range,
  Position,
  DiagnosticSeverity,
  Diagnostic,
  DidChangeConfigurationNotification,
  FoldingRange,
  FoldingRangeKind,
  FoldingRangeParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { InkService, SymbolKind, InkSymbol } from "./inkService";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const inkService = new InkService();

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;
  hasConfigurationCapability = !!(
    capabilities.workspace && capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && capabilities.workspace.workspaceFolders
  );

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [">", "{", "~", ".", "<", "("],
      },
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: false },
      hoverProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
    },
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
});

// --- Document sync ---

documents.onDidChangeContent((change) => {
  const doc = change.document;
  inkService.updateDocument(doc.uri, doc.getText());
  validateDocument(doc);
});

documents.onDidClose((event) => {
  inkService.removeDocument(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

let validationTimer: ReturnType<typeof setTimeout> | undefined;

function validateDocument(doc: TextDocument): void {
  if (validationTimer) clearTimeout(validationTimer);
  validationTimer = setTimeout(() => {
    const text = doc.getText();
    const inkDiags = inkService.getDiagnosticsFromCompiler(doc.uri, text);
    const diagnostics: Diagnostic[] = inkDiags.map((d) => ({
      range: Range.create(
        Position.create(Math.max(0, d.line), d.character),
        Position.create(Math.max(0, d.line), d.endCharacter)
      ),
      message: d.message,
      severity:
        d.severity === "error"
          ? DiagnosticSeverity.Error
          : d.severity === "warning"
            ? DiagnosticSeverity.Warning
            : DiagnosticSeverity.Information,
      source: d.source,
    }));
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
  }, 300);
}

// --- Completion ---

connection.onCompletion(
  (params: TextDocumentPositionParams): CompletionItem[] => {
    const items = inkService.getCompletionItems(
      params.textDocument.uri,
      params.position.line,
      params.position.character
    );

    return items.map((item, index) => ({
      label: item.label,
      kind: mapCompletionKind(item.kind),
      detail: item.detail,
      sortText: String(index).padStart(4, "0"),
      data: index,
    }));
  }
);

function mapCompletionKind(
  kind: SymbolKind | "builtin_function" | "builtin_constant"
): CompletionItemKind {
  switch (kind) {
    case SymbolKind.Knot:
      return CompletionItemKind.Module;
    case SymbolKind.Stitch:
      return CompletionItemKind.Function;
    case SymbolKind.Function:
    case SymbolKind.External:
      return CompletionItemKind.Function;
    case SymbolKind.Variable:
    case SymbolKind.TempVariable:
      return CompletionItemKind.Variable;
    case SymbolKind.Constant:
      return CompletionItemKind.Constant;
    case SymbolKind.List:
      return CompletionItemKind.Enum;
    case SymbolKind.Label:
      return CompletionItemKind.Reference;
    case "builtin_function":
      return CompletionItemKind.Function;
    case "builtin_constant":
      return CompletionItemKind.Constant;
    default:
      return CompletionItemKind.Text;
  }
}

// --- Go to Definition ---

connection.onDefinition(
  (params: DefinitionParams): Location | null => {
    const word = inkService.getWordAtPosition(
      params.textDocument.uri,
      params.position.line,
      params.position.character
    );
    if (!word) return null;

    const def = inkService.findDefinition(word);
    if (!def || !def.uri) return null;

    return Location.create(
      def.uri,
      Range.create(
        Position.create(def.line, def.character),
        Position.create(def.endLine, def.endCharacter)
      )
    );
  }
);

// --- Find References ---

connection.onReferences(
  (params: ReferenceParams): Location[] => {
    const word = inkService.getWordAtPosition(
      params.textDocument.uri,
      params.position.line,
      params.position.character
    );
    if (!word) return [];

    const refs = inkService.findAllReferences(word);
    const locations: Location[] = refs.map((ref) =>
      Location.create(
        ref.uri,
        Range.create(
          Position.create(ref.line, ref.character),
          Position.create(ref.line, ref.endCharacter)
        )
      )
    );

    // Also include the definition itself if requested
    if (params.context.includeDeclaration) {
      const def = inkService.findDefinition(word);
      if (def && def.uri) {
        locations.unshift(
          Location.create(
            def.uri,
            Range.create(
              Position.create(def.line, def.character),
              Position.create(def.endLine, def.endCharacter)
            )
          )
        );
      }
    }

    return locations;
  }
);

// --- Rename ---

connection.onRenameRequest(
  (params: RenameParams): WorkspaceEdit | null => {
    const word = inkService.getWordAtPosition(
      params.textDocument.uri,
      params.position.line,
      params.position.character
    );
    if (!word) return null;

    const changes: { [uri: string]: TextEdit[] } = {};

    // Rename at definition
    const def = inkService.findDefinition(word);
    if (def && def.uri) {
      if (!changes[def.uri]) changes[def.uri] = [];
      changes[def.uri].push(
        TextEdit.replace(
          Range.create(
            Position.create(def.line, def.character),
            Position.create(def.endLine, def.endCharacter)
          ),
          params.newName
        )
      );
    }

    // Rename at all references
    const refs = inkService.findAllReferences(word);
    for (const ref of refs) {
      if (!changes[ref.uri]) changes[ref.uri] = [];
      changes[ref.uri].push(
        TextEdit.replace(
          Range.create(
            Position.create(ref.line, ref.character),
            Position.create(ref.line, ref.endCharacter)
          ),
          params.newName
        )
      );
    }

    return { changes };
  }
);

// --- Hover ---

connection.onHover(
  (params: TextDocumentPositionParams): Hover | null => {
    const info = inkService.getHoverInfo(
      params.textDocument.uri,
      params.position.line,
      params.position.character
    );
    if (!info) return null;

    return {
      contents: {
        kind: "markdown",
        value: info,
      },
    };
  }
);

// --- Document Symbols (Outline) ---

connection.onDocumentSymbol(
  (params: DocumentSymbolParams): SymbolInformation[] => {
    const symbols = inkService.getSymbols(params.textDocument.uri);
    return symbols
      .filter(
        (s) =>
          s.kind !== SymbolKind.TempVariable && s.kind !== SymbolKind.Label
      )
      .map((sym) => ({
        name: formatSymbolName(sym),
        kind: mapSymbolKind(sym.kind),
        location: Location.create(
          params.textDocument.uri,
          Range.create(
            Position.create(sym.line, sym.character),
            Position.create(sym.endLine, sym.endCharacter)
          )
        ),
      }));
  }
);

function formatSymbolName(sym: InkSymbol): string {
  let name = sym.name;
  if (sym.params?.length) {
    name += `(${sym.params.join(", ")})`;
  }
  return name;
}

function mapSymbolKind(kind: SymbolKind): LSPSymbolKind {
  switch (kind) {
    case SymbolKind.Knot:
      return LSPSymbolKind.Module;
    case SymbolKind.Stitch:
      return LSPSymbolKind.Method;
    case SymbolKind.Function:
      return LSPSymbolKind.Function;
    case SymbolKind.Variable:
      return LSPSymbolKind.Variable;
    case SymbolKind.Constant:
      return LSPSymbolKind.Constant;
    case SymbolKind.TempVariable:
      return LSPSymbolKind.Variable;
    case SymbolKind.List:
      return LSPSymbolKind.Enum;
    case SymbolKind.External:
      return LSPSymbolKind.Interface;
    case SymbolKind.Label:
      return LSPSymbolKind.Key;
    case SymbolKind.Include:
      return LSPSymbolKind.File;
    default:
      return LSPSymbolKind.Variable;
  }
}

// --- Folding ---

connection.onFoldingRanges((params: FoldingRangeParams): FoldingRange[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const text = doc.getText();
  const lines = text.split("\n");
  const ranges: FoldingRange[] = [];

  // Track knot/stitch regions: each region ends when the next one starts (or EOF)
  const sectionStarts: { line: number; kind: "knot" | "stitch" }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^===\s*(?:function\s+)?\w+/.test(line)) {
      sectionStarts.push({ line: i, kind: "knot" });
    } else if (/^=\s+\w+/.test(line)) {
      sectionStarts.push({ line: i, kind: "stitch" });
    }
  }

  // Create folding ranges for each section
  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i].line;
    const nextStart = i + 1 < sectionStarts.length
      ? sectionStarts[i + 1].line
      : lines.length;

    // Find last non-empty line before next section
    let end = nextStart - 1;
    while (end > start && lines[end].trim() === "") {
      end--;
    }

    if (end > start) {
      ranges.push(FoldingRange.create(start, end, undefined, undefined, FoldingRangeKind.Region));
    }
  }

  // Block comments /* ... */
  let commentStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (commentStart === -1 && lines[i].trimStart().startsWith("/*")) {
      commentStart = i;
    }
    if (commentStart !== -1 && lines[i].includes("*/")) {
      if (i > commentStart) {
        ranges.push(FoldingRange.create(commentStart, i, undefined, undefined, FoldingRangeKind.Comment));
      }
      commentStart = -1;
    }
  }

  // Conditional blocks { ... }
  const braceStack: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^\{[^}]*$/.test(trimmed)) {
      braceStack.push(i);
    } else if (trimmed === "}" && braceStack.length > 0) {
      const openLine = braceStack.pop()!;
      if (i > openLine) {
        ranges.push(FoldingRange.create(openLine, i, undefined, undefined, FoldingRangeKind.Region));
      }
    }
  }

  return ranges;
});

// --- Custom requests for webview panels ---

connection.onRequest("ink/getSymbols", (params: { uri: string }) => {
  return inkService.getSymbols(params.uri);
});

connection.onRequest("ink/getGraph", () => {
  return inkService.buildGraph();
});

connection.onRequest("ink/getStatistics", (params: { readingSpeed?: number }) => {
  return inkService.computeStatistics(params?.readingSpeed || 200);
});

connection.onRequest("ink/getCompiled", (params: { uri: string }) => {
  const text = inkService.getDocumentText(params.uri);
  if (!text) return { success: false, error: "Document not found" };
  try {
    const { Compiler } = require("inkjs/compiler/Compiler");
    const compiler = new Compiler(text);
    const story = compiler.Compile();
    const json = story.ToJson();
    return { success: true, json };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
});

// --- Start ---

documents.listen(connection);
connection.listen();
