# Ink Language

The definitive [Ink](https://www.inklestudios.com/ink/) scripting language extension for Visual Studio Code.

Ink is inkle's open-source scripting language for writing interactive narrative, used in games like *80 Days*, *Sable*, *Heaven's Vault*, and *Vampire: The Masquerade — Bloodlines 2*.

## Features

### Editor

- **Syntax highlighting** for `.ink` and `.ink2` files
- **IntelliSense** — context-aware completions for knots, stitches, variables, lists, and built-in functions
- **Go to Definition** — jump to knot, stitch, variable, or function definitions
- **Find All References** — find every usage of a symbol across files
- **Rename Symbol** — rename knots, variables, and other symbols across files
- **Hover Information** — see symbol type, parameters, word count, and reference count
- **Document Outline** — navigate your story structure in the sidebar
- **Code Folding** — collapse knots, stitches, conditional blocks, and comments
- **Diagnostics** — real-time errors and warnings via the inkjs compiler
- **Snippets** — templates for knots, stitches, choices, conditionals, and more
- **Multi-file support** — `INCLUDE` directives are fully supported

### Sidebar

- **Story Outline** — tree view of all knots, stitches, and functions with click-to-navigate
- **Variables & Lists** — overview of all VAR, CONST, LIST, and EXTERNAL declarations

### Interactive Preview

- **Story Preview** — play through your story directly in VS Code
- **Choice selection** — click choices or use keyboard shortcuts (1-9)
- **Variable watch** — see variable values update in real time
- **Jump to knot** — skip to any knot during playtest
- **Go to source** — click to navigate from preview back to your Ink source
- **Auto-update on save** — preview refreshes when you save

### Analysis Tools

- **Branch Visualizer** — interactive SVG graph of your story structure with dead code detection
- **Statistics Panel** — word count, knot/stitch/choice counts, estimated playtime, unused variable detection
- **Compile to JSON** — export your story as inkjs-compatible JSON
- **Export Localization** — extract narrative text to CSV for translation

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Open a `.ink` file
3. Start writing — IntelliSense, diagnostics, and navigation work automatically

### Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Ink" to see all available commands:

| Command | Description |
|---------|-------------|
| `Ink: Preview Story` | Open interactive story preview |
| `Ink: Show Branch Visualizer` | Visualize story structure as a graph |
| `Ink: Show Statistics` | Show story metrics and analysis |
| `Ink: Compile to JSON` | Compile the current file to JSON |
| `Ink: Restart Story Preview` | Restart the preview from the beginning |
| `Ink: Export Localization (CSV)` | Export narrative text for translation |

### Snippets

Type these prefixes and press `Tab`:

| Prefix | Description |
|--------|-------------|
| `knot` | New knot |
| `knotp` | New knot with parameters |
| `stitch` | New stitch |
| `func` | New function |
| `choice` | Choice with divert |
| `sticky` | Sticky choice with divert |
| `var` | Global variable |
| `const` | Constant |
| `list` | List declaration |
| `if` | Conditional block |
| `ifelse` | Conditional with else |
| `tunnel` | Tunnel |
| `thread` | Thread |
| `include` | Include file |
| `external` | External function |
| `seq` | Shuffle sequence |
| `cycle` | Cycle sequence |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ink.mainFile` | `""` | Path to main `.ink` file for multi-file projects |
| `ink.compileOnSave` | `false` | Automatically compile to JSON on save |
| `ink.outputDirectory` | `""` | Directory for compiled JSON output |
| `ink.previewAutoUpdate` | `true` | Auto-update preview when source is saved |
| `ink.readingSpeed` | `200` | Reading speed (WPM) for playtime estimation |
| `ink.countAllVisits` | `false` | Enable COUNT_ALL_VISITS flag during compilation |

## Requirements

- VS Code 1.85.0 or later
- No external dependencies required (uses bundled inkjs compiler)

## About Ink

Ink is created by [inkle](https://www.inklestudios.com/). Learn more:

- [Ink documentation](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md)
- [Ink GitHub repository](https://github.com/inkle/ink)
- [Inky editor](https://github.com/inkle/inky) (inkle's official Ink editor)

## License

MIT
