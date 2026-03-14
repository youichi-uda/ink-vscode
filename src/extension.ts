import * as vscode from "vscode";
import * as path from "path";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { PreviewPanel } from "./previewPanel";
import { VisualizerPanel } from "./visualizerPanel";
import { StatisticsPanel } from "./statisticsPanel";
import { registerSidebar } from "./sidebarProvider";

let client: LanguageClient;

export async function activate(context: vscode.ExtensionContext) {
  // --- LSP Client ---
  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "ink" }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.ink"),
    },
  };

  client = new LanguageClient(
    "inkLanguageServer",
    "Ink Language Server",
    serverOptions,
    clientOptions
  );
  await client.start();

  // Load all .ink files in workspace for multi-file support
  loadWorkspaceInkFiles();

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand("ink.previewStory", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "ink") {
        PreviewPanel.createOrShow(context.extensionUri, editor.document, client);
      }
    }),

    vscode.commands.registerCommand("ink.showVisualizer", () => {
      VisualizerPanel.createOrShow(context.extensionUri, client);
    }),

    vscode.commands.registerCommand("ink.showStatistics", () => {
      const config = vscode.workspace.getConfiguration("ink");
      const readingSpeed = config.get<number>("readingSpeed", 200);
      StatisticsPanel.createOrShow(context.extensionUri, client, readingSpeed);
    }),

    vscode.commands.registerCommand("ink.compileStory", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "ink") {
        vscode.window.showWarningMessage("Open an .ink file first.");
        return;
      }

      const result: any = await client.sendRequest("ink/getCompiled", {
        uri: editor.document.uri.toString(),
      });

      if (result.success) {
        const config = vscode.workspace.getConfiguration("ink");
        const outputDir = config.get<string>("outputDirectory", "");
        const inkPath = editor.document.uri.fsPath;
        const jsonName = path.basename(inkPath, ".ink") + ".json";
        const outPath = outputDir
          ? path.join(
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
              outputDir,
              jsonName
            )
          : path.join(path.dirname(inkPath), jsonName);

        const outUri = vscode.Uri.file(outPath);
        await vscode.workspace.fs.writeFile(
          outUri,
          Buffer.from(result.json, "utf8")
        );
        vscode.window.showInformationMessage(`Compiled to ${outPath}`);
      } else {
        vscode.window.showErrorMessage(
          `Compilation failed: ${result.error}`
        );
      }
    }),

    vscode.commands.registerCommand("ink.restartPreview", () => {
      PreviewPanel.restart();
    }),

    vscode.commands.registerCommand("ink.exportLocalization", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "ink") {
        vscode.window.showWarningMessage("Open an .ink file first.");
        return;
      }
      await exportLocalization(editor.document);
    })
  );

  // Auto-compile on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId !== "ink") return;
      const config = vscode.workspace.getConfiguration("ink");
      if (config.get<boolean>("compileOnSave", false)) {
        vscode.commands.executeCommand("ink.compileStory");
      }
      // Update preview if open
      PreviewPanel.onDocumentSaved(doc, client);
    })
  );

  // --- Sidebar ---
  registerSidebar(context, client);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}

async function loadWorkspaceInkFiles() {
  const files = await vscode.workspace.findFiles("**/*.ink", "**/node_modules/**");
  for (const file of files) {
    const doc = await vscode.workspace.openTextDocument(file);
    // The LSP will pick this up via textDocument/didOpen
    // We just need to ensure the document is known
  }
}

async function exportLocalization(document: vscode.TextDocument) {
  const text = document.getText();
  const lines = text.split("\n");
  const rows: string[][] = [["Key", "Text", "File", "Line"]];

  let currentKnot = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const knotMatch = /^===\s*(?:function\s+)?(\w+)/.exec(line);
    if (knotMatch) {
      currentKnot = knotMatch[1];
      continue;
    }

    const trimmed = line.trim();
    // Skip non-text lines
    if (
      !trimmed ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("~") ||
      trimmed.startsWith("VAR ") ||
      trimmed.startsWith("CONST ") ||
      trimmed.startsWith("LIST ") ||
      trimmed.startsWith("EXTERNAL ") ||
      trimmed.startsWith("INCLUDE ") ||
      trimmed.startsWith("===") ||
      /^=\s+\w/.test(trimmed)
    ) {
      continue;
    }

    // Extract narrative text
    let narrative = trimmed;
    narrative = narrative.replace(/^[*+-]+\s*/, "");
    narrative = narrative.replace(/\{[^}]*\}/g, "");
    narrative = narrative.replace(/->[^\n]*/g, "");
    narrative = narrative.replace(/<-[^\n]*/g, "");
    narrative = narrative.replace(/<>/g, "");
    narrative = narrative.replace(/#[^#\n]*/g, "");
    narrative = narrative.replace(/\([^)]*\)/g, "");
    narrative = narrative.trim();

    if (narrative.length > 0) {
      const key = `${currentKnot}:${i + 1}`;
      rows.push([
        key,
        `"${narrative.replace(/"/g, '""')}"`,
        path.basename(document.uri.fsPath),
        String(i + 1),
      ]);
    }
  }

  const csv = rows.map((row) => row.join(",")).join("\n");
  const inkPath = document.uri.fsPath;
  const csvPath = inkPath.replace(/\.ink$/, "_localization.csv");
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(csvPath),
    Buffer.from(csv, "utf8")
  );
  vscode.window.showInformationMessage(`Localization exported to ${csvPath}`);
}
