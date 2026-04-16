# Binder for VS Code

[Binder](https://binder.do) is a local-first knowledge base with bidirectional Markdown sync — edit in any editor, query via CLI and MCP, share with AI agents.

Language support for Binder workspaces in VS Code.

<div align="center">
  <video autoplay loop muted playsinline width="720">
    <source src="https://assets.binder.do/binder-demo.webm" type="video/webm">
    <source src="https://assets.binder.do/binder-demo.mp4" type="video/mp4">
  </video>
</div>

## Features

<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <img src="https://raw.githubusercontent.com/mpazik/binder/main/.github/assets/screenshots/autocomplete.png" width="100%"/><br/>
      <b>Autocomplete</b> - links, field names, and valid values completed as you type.
    </td>
    <td align="center" valign="top" width="50%">
      <img src="https://raw.githubusercontent.com/mpazik/binder/main/.github/assets/screenshots/validation.png" width="100%"/><br/>
      <b>Validation</b> - inline diagnostics with hover docs showing valid options and field descriptions.
    </td>
  </tr>
</table>

- **Autocomplete** - link references, field names, and valid option values as you type
- **Hover docs** - field descriptions and allowed values on hover
- **Go to definition** - jump to any referenced entity
- **Inlay hints** - see referenced entity titles inline without leaving the file
- **Code actions** - quick fixes for invalid field values
- **Diagnostics** - real-time validation against your schema
- **Sync on save** - Markdown and YAML files stay in sync with the knowledge graph automatically

## Requirements

- Binder CLI must be installed and accessible in your PATH
- Your project must be a Binder workspace (contains a `.binder` directory)

To install the CLI and initialize a workspace:
```bash
npm install -g @binder.do/cli
binder init
```

## Extension Settings

- `binder.command`: Command to run the Binder CLI (default: `"binder"`)
- `binder.logLevel`: Log level for the Binder language server — `"info"` or `"debug"` (default: `"info"`)
- `binder.workspaces`: Explicit list of subdirectory paths containing binder workspaces. Bypasses automatic scanning when set (default: `[]`)
- `binderLsp.trace.server`: Traces the communication between VS Code and the language server — `"off"`, `"messages"`, or `"verbose"` (default: `"off"`)

## Usage

1. Open a folder that contains a `.binder` directory (or has subdirectories with `.binder`)
2. The extension activates automatically
3. Edit any `.md` or `.yaml` file — completions, diagnostics, and hints are live immediately
4. Save the file to sync changes to the knowledge graph

### Multi-Root Workspaces

The extension automatically discovers binder workspaces in the root and immediate subdirectories of each VS Code workspace folder. This means you can open a parent folder containing multiple binder projects and all of them will be active simultaneously.

To limit which subdirectories are scanned, set `binder.workspaces` to an explicit list of relative paths:

```json
{
  "binder.workspaces": ["project-a", "project-b"]
}
```

## Troubleshooting

### Check if the LSP server is running

1. Open the Output panel (View → Output or Cmd+Shift+U)
2. Select "Binder LSP" from the dropdown
3. You should see server logs indicating the connection status

### Configure a custom CLI path

If Binder CLI is not in your PATH:

1. Open Settings (Cmd+,)
2. Search for "binder.command"
3. Set the command or absolute path to your binder executable

### Extension not activating

The extension activates when a `.binder` directory is present in the workspace root or in an immediate subdirectory.

## More Information

Visit [binder.do](https://binder.do) or the [GitHub repository](https://github.com/mpazik/binder).

## Other Editors

### WebStorm / IntelliJ

Install the [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) plugin, then add a new language server under **Settings → Languages & Frameworks → Language Servers**:

- **Command**: `binder lsp`
- **File patterns**: `*.md`, `*.yaml`

### Neovim

```lua
require('lspconfig').configs.binder = {
  default_config = {
    cmd = { 'binder', 'lsp' },
    filetypes = { 'markdown', 'yaml' },
    root_dir = require('lspconfig.util').root_pattern('.binder'),
  },
}
require('lspconfig').binder.setup({})
```
