/**
 * InkService — Ink language analysis service
 *
 * Uses regex-based parsing for symbol extraction (works with incomplete/invalid code)
 * and inkjs Compiler for diagnostics (errors/warnings).
 */

export interface InkSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  detail?: string;
  children?: InkSymbol[];
  params?: string[];
  uri?: string;
}

export enum SymbolKind {
  Knot = "knot",
  Stitch = "stitch",
  Function = "function",
  Variable = "variable",
  Constant = "constant",
  TempVariable = "temp",
  List = "list",
  External = "external",
  Label = "label",
  Include = "include",
}

export interface InkReference {
  uri: string;
  line: number;
  character: number;
  endCharacter: number;
  symbolName: string;
  kind: "divert" | "variable_use" | "function_call" | "list_use";
}

export interface InkDiagnostic {
  line: number;
  character: number;
  endCharacter: number;
  message: string;
  severity: "error" | "warning" | "info";
  source: string;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: SymbolKind;
  wordCount: number;
  choiceCount: number;
  isDeadCode: boolean;
  uri?: string;
  line?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  kind: "divert" | "choice" | "tunnel" | "thread";
}

export interface StoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface StoryStatistics {
  totalWords: number;
  totalKnots: number;
  totalStitches: number;
  totalChoices: number;
  totalGathers: number;
  totalDiverts: number;
  totalVariables: number;
  totalConstants: number;
  totalLists: number;
  totalFunctions: number;
  totalIncludes: number;
  estimatedPlaytimeMinutes: number;
  knotWordCounts: { name: string; words: number }[];
  deadKnots: string[];
  unusedVariables: string[];
}

// Regex patterns for symbol extraction
const KNOT_RE = /^===\s*(?:function\s+)?(\w+)\s*(?:\(([^)]*)\))?\s*={0,3}\s*$/gm;
const FUNCTION_RE = /^===\s*function\s+(\w+)\s*(?:\(([^)]*)\))?\s*={0,3}\s*$/gm;
const STITCH_RE = /^=\s+(\w+)\s*(?:\(([^)]*)\))?\s*$/gm;
const VAR_RE = /^(?:VAR)\s+(\w+)\s*=/gm;
const CONST_RE = /^(?:CONST)\s+(\w+)\s*=/gm;
const TEMP_RE = /^\s*~\s*temp\s+(\w+)\s*=/gim;
const LIST_RE = /^LIST\s+(\w+)\s*=/gm;
const EXTERNAL_RE = /^EXTERNAL\s+(\w+)\s*\(([^)]*)\)/gm;
const INCLUDE_RE = /^INCLUDE\s+(.+)$/gm;
const DIVERT_RE = /->(?!->)\s*(\w+(?:\.\w+)?)/g;
const THREAD_RE = /<-\s*(\w+(?:\.\w+)?)/g;
const TUNNEL_RE = /->\s*(\w+(?:\.\w+)?)\s*->/g;
const CHOICE_RE = /^(\s*[*+]+)/gm;
const GATHER_RE = /^(\s*-+)\s/gm;
const LABEL_RE = /^[\s*+-]*\((\w+)\)/gm;
const TAG_RE = /#\s*(.+)$/gm;

const BUILTIN_FUNCTIONS = [
  "RANDOM",
  "LIST_COUNT",
  "TURNS_SINCE",
  "CHOICE_COUNT",
  "SEED_RANDOM",
  "LIST_MIN",
  "LIST_MAX",
  "LIST_ALL",
  "LIST_RANGE",
  "LIST_INVERT",
  "LIST_VALUE",
  "READ_COUNT",
  "POW",
  "FLOOR",
  "CEILING",
  "INT",
  "FLOAT",
  "LIST_RANDOM",
];

const BUILTIN_CONSTANTS = ["END", "DONE"];

export class InkService {
  private documentSymbols: Map<string, InkSymbol[]> = new Map();
  private documentReferences: Map<string, InkReference[]> = new Map();
  private documentTexts: Map<string, string> = new Map();
  private includeGraph: Map<string, string[]> = new Map();

  updateDocument(uri: string, text: string): void {
    this.documentTexts.set(uri, text);
    this.documentSymbols.set(uri, this.extractSymbols(uri, text));
    this.documentReferences.set(uri, this.extractReferences(uri, text));
    this.includeGraph.set(uri, this.extractIncludes(text));
  }

  removeDocument(uri: string): void {
    this.documentTexts.delete(uri);
    this.documentSymbols.delete(uri);
    this.documentReferences.delete(uri);
    this.includeGraph.delete(uri);
  }

  getSymbols(uri: string): InkSymbol[] {
    return this.documentSymbols.get(uri) || [];
  }

  getAllSymbols(): InkSymbol[] {
    const all: InkSymbol[] = [];
    for (const symbols of this.documentSymbols.values()) {
      all.push(...symbols);
    }
    return all;
  }

  getReferences(uri: string): InkReference[] {
    return this.documentReferences.get(uri) || [];
  }

  getAllReferences(): InkReference[] {
    const all: InkReference[] = [];
    for (const refs of this.documentReferences.values()) {
      all.push(...refs);
    }
    return all;
  }

  getDocumentText(uri: string): string {
    return this.documentTexts.get(uri) || "";
  }

  getAllDocumentUris(): string[] {
    return Array.from(this.documentTexts.keys());
  }

  private extractSymbols(uri: string, text: string): InkSymbol[] {
    const symbols: InkSymbol[] = [];
    const lines = text.split("\n");

    let currentKnot: InkSymbol | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Knot / Function
      const knotMatch = /^===\s*(function\s+)?(\w+)\s*(?:\(([^)]*)\))?\s*={0,3}\s*$/.exec(line);
      if (knotMatch) {
        const isFunction = !!knotMatch[1];
        const name = knotMatch[2];
        const params = knotMatch[3]
          ? knotMatch[3].split(",").map((p) => p.trim()).filter(Boolean)
          : undefined;
        const nameStart = line.indexOf(name);
        const symbol: InkSymbol = {
          name,
          kind: isFunction ? SymbolKind.Function : SymbolKind.Knot,
          line: i,
          character: nameStart,
          endLine: i,
          endCharacter: nameStart + name.length,
          params,
          children: [],
          uri,
        };
        currentKnot = symbol;
        symbols.push(symbol);
        continue;
      }

      // Stitch
      const stitchMatch = /^=\s+(\w+)\s*(?:\(([^)]*)\))?\s*$/.exec(line);
      if (stitchMatch) {
        const name = stitchMatch[1];
        const params = stitchMatch[2]
          ? stitchMatch[2].split(",").map((p) => p.trim()).filter(Boolean)
          : undefined;
        const nameStart = line.indexOf(name);
        const symbol: InkSymbol = {
          name,
          kind: SymbolKind.Stitch,
          line: i,
          character: nameStart,
          endLine: i,
          endCharacter: nameStart + name.length,
          params,
          uri,
        };
        if (currentKnot) {
          currentKnot.children = currentKnot.children || [];
          currentKnot.children.push(symbol);
        }
        symbols.push(symbol);
        continue;
      }

      // VAR
      const varMatch = /^VAR\s+(\w+)\s*=\s*(.*)$/.exec(line);
      if (varMatch) {
        const name = varMatch[1];
        const nameStart = line.indexOf(name);
        symbols.push({
          name,
          kind: SymbolKind.Variable,
          line: i,
          character: nameStart,
          endLine: i,
          endCharacter: nameStart + name.length,
          detail: `VAR ${name} = ${varMatch[2].trim()}`,
          uri,
        });
        continue;
      }

      // CONST
      const constMatch = /^CONST\s+(\w+)\s*=\s*(.*)$/.exec(line);
      if (constMatch) {
        const name = constMatch[1];
        const nameStart = line.indexOf(name);
        symbols.push({
          name,
          kind: SymbolKind.Constant,
          line: i,
          character: nameStart,
          endLine: i,
          endCharacter: nameStart + name.length,
          detail: `CONST ${name} = ${constMatch[2].trim()}`,
          uri,
        });
        continue;
      }

      // LIST
      const listMatch = /^LIST\s+(\w+)\s*=\s*(.*)$/.exec(line);
      if (listMatch) {
        const name = listMatch[1];
        const nameStart = line.indexOf(name);
        symbols.push({
          name,
          kind: SymbolKind.List,
          line: i,
          character: nameStart,
          endLine: i,
          endCharacter: nameStart + name.length,
          detail: `LIST ${name} = ${listMatch[2].trim()}`,
          uri,
        });
        continue;
      }

      // EXTERNAL
      const extMatch = /^EXTERNAL\s+(\w+)\s*\(([^)]*)\)/.exec(line);
      if (extMatch) {
        const name = extMatch[1];
        const nameStart = line.indexOf(name);
        const params = extMatch[2]
          ? extMatch[2].split(",").map((p) => p.trim()).filter(Boolean)
          : undefined;
        symbols.push({
          name,
          kind: SymbolKind.External,
          line: i,
          character: nameStart,
          endLine: i,
          endCharacter: nameStart + name.length,
          params,
          uri,
        });
        continue;
      }

      // temp variable
      const tempMatch = /^\s*~\s*temp\s+(\w+)\s*=/.exec(line);
      if (tempMatch) {
        const name = tempMatch[1];
        const nameStart = line.indexOf(name);
        symbols.push({
          name,
          kind: SymbolKind.TempVariable,
          line: i,
          character: nameStart,
          endLine: i,
          endCharacter: nameStart + name.length,
          uri,
        });
        continue;
      }

      // Labels
      const labelMatch = /^[\s*+-]*\((\w+)\)/.exec(line);
      if (labelMatch) {
        const name = labelMatch[1];
        const nameStart = line.indexOf("(" + name);
        symbols.push({
          name,
          kind: SymbolKind.Label,
          line: i,
          character: nameStart + 1,
          endLine: i,
          endCharacter: nameStart + 1 + name.length,
          uri,
        });
      }
    }

    return symbols;
  }

  private extractReferences(uri: string, text: string): InkReference[] {
    const refs: InkReference[] = [];
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comment lines
      if (line.trimStart().startsWith("//")) continue;

      // Diverts: -> target
      let match: RegExpExecArray | null;
      const divertRe = /->(?!->)\s*(\w+(?:\.\w+)?)/g;
      while ((match = divertRe.exec(line)) !== null) {
        const target = match[1];
        if (BUILTIN_CONSTANTS.includes(target)) continue;
        const targetStart = match.index + match[0].indexOf(target);
        refs.push({
          uri,
          line: i,
          character: targetStart,
          endCharacter: targetStart + target.length,
          symbolName: target,
          kind: "divert",
        });
      }

      // Threads: <- target
      const threadRe = /<-\s*(\w+(?:\.\w+)?)/g;
      while ((match = threadRe.exec(line)) !== null) {
        const target = match[1];
        const targetStart = match.index + match[0].indexOf(target);
        refs.push({
          uri,
          line: i,
          character: targetStart,
          endCharacter: targetStart + target.length,
          symbolName: target,
          kind: "divert",
        });
      }

      // Tunnel diverts: -> target ->
      const tunnelRe = /->\s*(\w+(?:\.\w+)?)\s*->/g;
      while ((match = tunnelRe.exec(line)) !== null) {
        const target = match[1];
        if (BUILTIN_CONSTANTS.includes(target)) continue;
        const targetStart = match.index + match[0].indexOf(target);
        refs.push({
          uri,
          line: i,
          character: targetStart,
          endCharacter: targetStart + target.length,
          symbolName: target,
          kind: "divert",
        });
      }

      // Variable uses inside { }
      const braceRe = /\{([^}]+)\}/g;
      while ((match = braceRe.exec(line)) !== null) {
        const content = match[1];
        const braceStart = match.index + 1;
        // Look for identifiers in the brace content
        const identRe = /\b([a-zA-Z_]\w*)\b/g;
        let identMatch: RegExpExecArray | null;
        while ((identMatch = identRe.exec(content)) !== null) {
          const name = identMatch[1];
          // Skip keywords and built-in functions
          if (isKeyword(name)) continue;
          refs.push({
            uri,
            line: i,
            character: braceStart + identMatch.index,
            endCharacter: braceStart + identMatch.index + name.length,
            symbolName: name,
            kind: "variable_use",
          });
        }
      }

      // Code lines: ~ expression
      const codeMatch = /^\s*~\s*(.+)$/.exec(line);
      if (codeMatch && !line.match(/^\s*~\s*temp\s+/)) {
        const codeContent = codeMatch[1];
        const codeStart = line.indexOf(codeContent);
        const identRe = /\b([a-zA-Z_]\w*)\b/g;
        let identMatch: RegExpExecArray | null;
        while ((identMatch = identRe.exec(codeContent)) !== null) {
          const name = identMatch[1];
          if (isKeyword(name)) continue;
          refs.push({
            uri,
            line: i,
            character: codeStart + identMatch.index,
            endCharacter: codeStart + identMatch.index + name.length,
            symbolName: name,
            kind: "variable_use",
          });
        }
      }
    }

    return refs;
  }

  private extractIncludes(text: string): string[] {
    const includes: string[] = [];
    const re = /^INCLUDE\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      includes.push(match[1].trim());
    }
    return includes;
  }

  getIncludes(uri: string): string[] {
    return this.includeGraph.get(uri) || [];
  }

  findSymbolAtPosition(
    uri: string,
    line: number,
    character: number
  ): { symbol: InkSymbol; isDefinition: boolean } | null {
    // Check definitions
    const symbols = this.getSymbols(uri);
    for (const sym of symbols) {
      if (
        sym.line === line &&
        character >= sym.character &&
        character <= sym.endCharacter
      ) {
        return { symbol: sym, isDefinition: true };
      }
    }

    // Check references
    const refs = this.getReferences(uri);
    for (const ref of refs) {
      if (
        ref.line === line &&
        character >= ref.character &&
        character <= ref.endCharacter
      ) {
        const def = this.findDefinition(ref.symbolName);
        if (def) {
          return { symbol: def, isDefinition: false };
        }
      }
    }

    return null;
  }

  findDefinition(name: string): InkSymbol | null {
    // Handle dotted names: knot.stitch
    const parts = name.split(".");
    const allSymbols = this.getAllSymbols();

    if (parts.length === 2) {
      const knot = allSymbols.find(
        (s) => s.name === parts[0] && (s.kind === SymbolKind.Knot || s.kind === SymbolKind.Function)
      );
      if (knot && knot.children) {
        const stitch = knot.children.find((s) => s.name === parts[1]);
        if (stitch) return stitch;
      }
    }

    // Simple name lookup
    return (
      allSymbols.find(
        (s) =>
          s.name === name &&
          s.kind !== SymbolKind.TempVariable &&
          s.kind !== SymbolKind.Label
      ) || allSymbols.find((s) => s.name === name) || null
    );
  }

  findAllReferences(name: string): InkReference[] {
    const allRefs = this.getAllReferences();
    const baseName = name.split(".")[0];
    return allRefs.filter(
      (ref) => ref.symbolName === name || ref.symbolName === baseName || ref.symbolName.startsWith(name + ".")
    );
  }

  getWordAtPosition(uri: string, line: number, character: number): string | null {
    const text = this.documentTexts.get(uri);
    if (!text) return null;
    const lines = text.split("\n");
    if (line >= lines.length) return null;
    const lineText = lines[line];
    // Find word boundaries
    let start = character;
    let end = character;
    while (start > 0 && /[\w.]/.test(lineText[start - 1])) start--;
    while (end < lineText.length && /[\w.]/.test(lineText[end])) end++;
    if (start === end) return null;
    return lineText.substring(start, end);
  }

  getCompletionContext(
    uri: string,
    line: number,
    character: number
  ): { kind: "divert" | "variable" | "general"; prefix: string } {
    const text = this.documentTexts.get(uri);
    if (!text) return { kind: "general", prefix: "" };
    const lines = text.split("\n");
    if (line >= lines.length) return { kind: "general", prefix: "" };
    const lineText = lines[line];
    const before = lineText.substring(0, character);

    // After -> : divert target completion
    if (/->(?!->)\s*\w*$/.test(before)) {
      const match = /(\w*)$/.exec(before);
      return { kind: "divert", prefix: match ? match[1] : "" };
    }

    // After <- : thread target completion
    if (/<-\s*\w*$/.test(before)) {
      const match = /(\w*)$/.exec(before);
      return { kind: "divert", prefix: match ? match[1] : "" };
    }

    // Inside { } : variable/expression completion
    const openBraces = (before.match(/\{/g) || []).length;
    const closeBraces = (before.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      const match = /(\w*)$/.exec(before);
      return { kind: "variable", prefix: match ? match[1] : "" };
    }

    // After ~ : code line completion
    if (/^\s*~\s+/.test(before)) {
      const match = /(\w*)$/.exec(before);
      return { kind: "variable", prefix: match ? match[1] : "" };
    }

    const match = /(\w*)$/.exec(before);
    return { kind: "general", prefix: match ? match[1] : "" };
  }

  getCompletionItems(
    uri: string,
    line: number,
    character: number
  ): { label: string; kind: SymbolKind | "builtin_function" | "builtin_constant"; detail?: string }[] {
    const ctx = this.getCompletionContext(uri, line, character);
    const allSymbols = this.getAllSymbols();
    const items: { label: string; kind: SymbolKind | "builtin_function" | "builtin_constant"; detail?: string }[] = [];
    const seen = new Set<string>();

    const addUnique = (label: string, kind: SymbolKind | "builtin_function" | "builtin_constant", detail?: string) => {
      if (!seen.has(label) && label.toLowerCase().startsWith(ctx.prefix.toLowerCase())) {
        seen.add(label);
        items.push({ label, kind, detail });
      }
    };

    if (ctx.kind === "divert") {
      // Complete knot and stitch names
      for (const sym of allSymbols) {
        if (sym.kind === SymbolKind.Knot || sym.kind === SymbolKind.Function) {
          addUnique(sym.name, sym.kind);
          // Also add knot.stitch completions
          if (sym.children) {
            for (const child of sym.children) {
              addUnique(`${sym.name}.${child.name}`, SymbolKind.Stitch);
            }
          }
        }
        if (sym.kind === SymbolKind.Label) {
          addUnique(sym.name, sym.kind);
        }
      }
      // Built-in destinations
      addUnique("END", "builtin_constant");
      addUnique("DONE", "builtin_constant");
    } else if (ctx.kind === "variable") {
      // Complete variables, constants, lists, functions
      for (const sym of allSymbols) {
        if (
          sym.kind === SymbolKind.Variable ||
          sym.kind === SymbolKind.Constant ||
          sym.kind === SymbolKind.TempVariable ||
          sym.kind === SymbolKind.List
        ) {
          addUnique(sym.name, sym.kind, sym.detail);
        }
        if (sym.kind === SymbolKind.Function || sym.kind === SymbolKind.External) {
          addUnique(sym.name, sym.kind);
        }
        if (sym.kind === SymbolKind.Knot) {
          addUnique(sym.name, sym.kind);
        }
      }
      // Built-in functions
      for (const fn of BUILTIN_FUNCTIONS) {
        addUnique(fn, "builtin_function");
      }
      // Boolean constants
      addUnique("true", "builtin_constant");
      addUnique("false", "builtin_constant");
      addUnique("not", "builtin_constant");
    } else {
      // General: all symbols
      for (const sym of allSymbols) {
        addUnique(sym.name, sym.kind, sym.detail);
      }
    }

    return items;
  }

  getHoverInfo(uri: string, line: number, character: number): string | null {
    const word = this.getWordAtPosition(uri, line, character);
    if (!word) return null;

    // Built-in function docs
    const builtinDoc = getBuiltinFunctionDoc(word);
    if (builtinDoc) return builtinDoc;

    const def = this.findDefinition(word);
    if (!def) return null;

    let info = "";
    switch (def.kind) {
      case SymbolKind.Knot: {
        const childCount = def.children?.length || 0;
        const choiceCount = this.countChoicesInKnot(def);
        const wordCount = this.countWordsInKnot(def);
        info = `**knot** \`${def.name}\``;
        if (def.params?.length) info += `(${def.params.join(", ")})`;
        info += `\n\nStitches: ${childCount} | Choices: ${choiceCount} | Words: ~${wordCount}`;
        break;
      }
      case SymbolKind.Function:
        info = `**function** \`${def.name}\``;
        if (def.params?.length) info += `(${def.params.join(", ")})`;
        break;
      case SymbolKind.Stitch:
        info = `**stitch** \`${def.name}\``;
        if (def.params?.length) info += `(${def.params.join(", ")})`;
        break;
      case SymbolKind.Variable:
        info = def.detail || `**VAR** \`${def.name}\``;
        break;
      case SymbolKind.Constant:
        info = def.detail || `**CONST** \`${def.name}\``;
        break;
      case SymbolKind.List:
        info = def.detail || `**LIST** \`${def.name}\``;
        break;
      case SymbolKind.External:
        info = `**EXTERNAL** \`${def.name}\``;
        if (def.params?.length) info += `(${def.params.join(", ")})`;
        break;
      case SymbolKind.TempVariable:
        info = `**temp** \`${def.name}\``;
        break;
      case SymbolKind.Label:
        info = `**label** \`${def.name}\``;
        break;
      default:
        info = `\`${def.name}\``;
    }

    const refs = this.findAllReferences(def.name);
    info += `\n\nReferences: ${refs.length}`;

    return info;
  }

  private countChoicesInKnot(knot: InkSymbol): number {
    if (!knot.uri) return 0;
    const text = this.documentTexts.get(knot.uri);
    if (!text) return 0;
    const lines = text.split("\n");
    const startLine = knot.line + 1;
    let endLine = lines.length;

    // Find next knot
    for (let i = startLine; i < lines.length; i++) {
      if (/^===/.test(lines[i])) {
        endLine = i;
        break;
      }
    }

    let count = 0;
    for (let i = startLine; i < endLine; i++) {
      if (/^\s*[*+]/.test(lines[i])) count++;
    }
    return count;
  }

  private countWordsInKnot(knot: InkSymbol): number {
    if (!knot.uri) return 0;
    const text = this.documentTexts.get(knot.uri);
    if (!text) return 0;
    const lines = text.split("\n");
    const startLine = knot.line + 1;
    let endLine = lines.length;

    for (let i = startLine; i < lines.length; i++) {
      if (/^===/.test(lines[i])) {
        endLine = i;
        break;
      }
    }

    return countNarrativeWords(lines.slice(startLine, endLine));
  }

  buildGraph(): StoryGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const allSymbols = this.getAllSymbols();
    const allRefs = this.getAllReferences();
    const nodeIds = new Set<string>();

    // Build nodes from knots and functions
    for (const sym of allSymbols) {
      if (sym.kind === SymbolKind.Knot || sym.kind === SymbolKind.Function) {
        nodeIds.add(sym.name);
        nodes.push({
          id: sym.name,
          label: sym.name,
          kind: sym.kind,
          wordCount: this.countWordsInKnot(sym),
          choiceCount: this.countChoicesInKnot(sym),
          isDeadCode: false,
          uri: sym.uri,
          line: sym.line,
        });
      }
    }

    // Build edges from diverts
    for (const ref of allRefs) {
      if (ref.kind === "divert") {
        const targetBase = ref.symbolName.split(".")[0];
        // Find the source knot for this reference
        const sourceKnot = this.findContainingKnot(ref.uri, ref.line);
        if (sourceKnot && nodeIds.has(targetBase)) {
          edges.push({
            from: sourceKnot,
            to: targetBase,
            kind: "divert",
          });
        }
      }
    }

    // Detect dead code (unreachable knots)
    const reachable = new Set<string>();
    // Start from the first knot or a knot named "start"
    const startKnots = nodes.filter(
      (n) => n.id === "start" || n.id === nodes[0]?.id
    );
    const queue = startKnots.map((n) => n.id);
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const edge of edges) {
        if (edge.from === current && !reachable.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }

    for (const node of nodes) {
      if (!reachable.has(node.id) && node.id !== nodes[0]?.id) {
        node.isDeadCode = true;
      }
    }

    return { nodes, edges };
  }

  private findContainingKnot(uri: string, line: number): string | null {
    const symbols = this.getSymbols(uri);
    let containing: string | null = null;
    for (const sym of symbols) {
      if (
        (sym.kind === SymbolKind.Knot || sym.kind === SymbolKind.Function) &&
        sym.line <= line
      ) {
        containing = sym.name;
      }
    }
    return containing;
  }

  computeStatistics(readingSpeedWpm: number = 200): StoryStatistics {
    const allSymbols = this.getAllSymbols();
    const graph = this.buildGraph();

    let totalChoices = 0;
    let totalGathers = 0;
    let totalDiverts = 0;

    for (const text of this.documentTexts.values()) {
      const lines = text.split("\n");
      for (const line of lines) {
        if (/^\s*[*+]/.test(line)) totalChoices++;
        if (/^\s*-\s/.test(line)) totalGathers++;
        if (/->(?!->)/.test(line)) totalDiverts++;
      }
    }

    const knots = allSymbols.filter((s) => s.kind === SymbolKind.Knot);
    const knotWordCounts = knots.map((k) => ({
      name: k.name,
      words: this.countWordsInKnot(k),
    }));
    knotWordCounts.sort((a, b) => b.words - a.words);

    const totalWords = knotWordCounts.reduce((sum, k) => sum + k.words, 0);

    // Find unused variables
    const variables = allSymbols.filter(
      (s) => s.kind === SymbolKind.Variable || s.kind === SymbolKind.Constant
    );
    const allRefs = this.getAllReferences();
    const referencedNames = new Set(allRefs.map((r) => r.symbolName));
    const unusedVariables = variables
      .filter((v) => !referencedNames.has(v.name))
      .map((v) => v.name);

    return {
      totalWords,
      totalKnots: knots.length,
      totalStitches: allSymbols.filter((s) => s.kind === SymbolKind.Stitch).length,
      totalChoices,
      totalGathers,
      totalDiverts,
      totalVariables: allSymbols.filter((s) => s.kind === SymbolKind.Variable).length,
      totalConstants: allSymbols.filter((s) => s.kind === SymbolKind.Constant).length,
      totalLists: allSymbols.filter((s) => s.kind === SymbolKind.List).length,
      totalFunctions: allSymbols.filter((s) => s.kind === SymbolKind.Function).length,
      totalIncludes: Array.from(this.includeGraph.values()).reduce(
        (sum, includes) => sum + includes.length,
        0
      ),
      estimatedPlaytimeMinutes: Math.ceil(totalWords / readingSpeedWpm),
      knotWordCounts,
      deadKnots: graph.nodes.filter((n) => n.isDeadCode).map((n) => n.id),
      unusedVariables,
    };
  }

  getDiagnosticsFromCompiler(uri: string, text: string): InkDiagnostic[] {
    try {
      // Dynamic import to handle cases where inkjs compiler is available
      const { Compiler } = require("inkjs/compiler/Compiler");
      const compiler = new Compiler(text);
      compiler.Compile();

      const diagnostics: InkDiagnostic[] = [];

      if (compiler.errors) {
        for (const error of compiler.errors) {
          const parsed = parseInkMessage(error);
          diagnostics.push({ ...parsed, severity: "error", source: "inkjs" });
        }
      }

      if (compiler.warnings) {
        for (const warning of compiler.warnings) {
          const parsed = parseInkMessage(warning);
          diagnostics.push({ ...parsed, severity: "warning", source: "inkjs" });
        }
      }

      // Dead code warnings
      const graph = this.buildGraph();
      for (const node of graph.nodes) {
        if (node.isDeadCode && node.line !== undefined) {
          diagnostics.push({
            line: node.line,
            character: 0,
            endCharacter: 100,
            message: `Knot '${node.id}' appears to be unreachable`,
            severity: "warning",
            source: "ink-pro",
          });
        }
      }

      return diagnostics;
    } catch (e: any) {
      // If compilation throws, extract error info
      const message = e?.message || String(e);
      const parsed = parseInkMessage(message);
      return [{ ...parsed, severity: "error", source: "inkjs" }];
    }
  }
}

function parseInkMessage(msg: string): { line: number; character: number; endCharacter: number; message: string } {
  // ink error format: "ERROR: 'filename' line 5: message" or "line 5: message"
  const lineMatch = /line (\d+):\s*(.*)/.exec(msg);
  if (lineMatch) {
    return {
      line: parseInt(lineMatch[1], 10) - 1,
      character: 0,
      endCharacter: 1000,
      message: lineMatch[2] || msg,
    };
  }
  return { line: 0, character: 0, endCharacter: 1000, message: msg };
}

function isKeyword(name: string): boolean {
  const keywords = new Set([
    "true", "false", "not", "and", "or", "mod",
    "VAR", "CONST", "LIST", "EXTERNAL", "INCLUDE",
    "temp", "return", "else", "function",
    "END", "DONE",
    "RANDOM", "LIST_COUNT", "TURNS_SINCE", "CHOICE_COUNT",
    "SEED_RANDOM", "LIST_MIN", "LIST_MAX", "LIST_ALL",
    "LIST_RANGE", "LIST_INVERT", "LIST_VALUE", "READ_COUNT",
    "POW", "FLOOR", "CEILING", "INT", "FLOAT", "LIST_RANDOM",
    "ref", "if", "stopping", "cycle", "shuffle", "once",
  ]);
  return keywords.has(name);
}

function countNarrativeWords(lines: string[]): number {
  let words = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip non-narrative lines
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("===") ||
      trimmed.startsWith("=") && /^=\s+\w/.test(trimmed) ||
      trimmed.startsWith("VAR ") ||
      trimmed.startsWith("CONST ") ||
      trimmed.startsWith("LIST ") ||
      trimmed.startsWith("EXTERNAL ") ||
      trimmed.startsWith("INCLUDE ") ||
      trimmed.startsWith("~") ||
      trimmed === ""
    ) {
      continue;
    }

    // Remove ink syntax to count only narrative words
    let narrative = trimmed;
    narrative = narrative.replace(/^[*+-]+\s*/, ""); // Remove choice/gather markers
    narrative = narrative.replace(/\{[^}]*\}/g, ""); // Remove logic blocks
    narrative = narrative.replace(/->[^,\n]*/g, ""); // Remove diverts
    narrative = narrative.replace(/<-[^,\n]*/g, ""); // Remove threads
    narrative = narrative.replace(/<>/g, ""); // Remove glue
    narrative = narrative.replace(/#[^#\n]*/g, ""); // Remove tags
    narrative = narrative.replace(/\([^)]*\)/g, ""); // Remove labels
    narrative = narrative.replace(/\[[^\]]*\]/g, ""); // Remove suppression brackets

    const w = narrative.trim().split(/\s+/).filter(Boolean);
    words += w.length;
  }
  return words;
}

function getBuiltinFunctionDoc(name: string): string | null {
  const docs: Record<string, string> = {
    RANDOM: "**RANDOM(min, max)** — Returns a random integer between min and max (inclusive)",
    LIST_COUNT: "**LIST_COUNT(list)** — Returns the number of items in the list",
    TURNS_SINCE: "**TURNS_SINCE(-> knot)** — Returns the number of turns since the knot was last visited (-1 if never)",
    CHOICE_COUNT: "**CHOICE_COUNT()** — Returns the number of choices available at the current point",
    SEED_RANDOM: "**SEED_RANDOM(seed)** — Seeds the random number generator for reproducible results",
    LIST_MIN: "**LIST_MIN(list)** — Returns the item with the lowest value in the list",
    LIST_MAX: "**LIST_MAX(list)** — Returns the item with the highest value in the list",
    LIST_ALL: "**LIST_ALL(list)** — Returns all possible items for the list's type",
    LIST_RANGE: "**LIST_RANGE(list, min, max)** — Returns items within the value range",
    LIST_INVERT: "**LIST_INVERT(list)** — Returns all items NOT in the list",
    LIST_VALUE: "**LIST_VALUE(item)** — Returns the integer value of a list item",
    LIST_RANDOM: "**LIST_RANDOM(list)** — Returns a random item from the list",
    READ_COUNT: "**READ_COUNT(-> knot)** — Returns how many times a knot has been visited",
    POW: "**POW(base, exponent)** — Returns base raised to the power of exponent",
    FLOOR: "**FLOOR(number)** — Rounds down to the nearest integer",
    CEILING: "**CEILING(number)** — Rounds up to the nearest integer",
    INT: "**INT(value)** — Casts a value to integer",
    FLOAT: "**FLOAT(value)** — Casts a value to float",
  };
  return docs[name] || null;
}
