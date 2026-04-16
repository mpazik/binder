# Binder for IntelliJ

[Binder](https://binder.do) is a local-first knowledge base with bidirectional Markdown sync — edit in any editor, query via CLI and MCP, share with AI agents.

Language support for Binder workspaces in WebStorm, IntelliJ IDEA, and other JetBrains IDEs.

## Features

<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <img src="https://raw.githubusercontent.com/mpazik/binder/main/.github/assets/screenshots/intellij.png" width="100%"/><br/>
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
- **Status bar widget** - shows LSP server status; click to view logs, open settings, or restart the server

## Requirements

- WebStorm 2025.1+, IntelliJ IDEA Ultimate 2025.1+, or any JetBrains IDE 2025.1+ with built-in LSP support
- Binder CLI installed and accessible in your PATH

To install the CLI and initialize a workspace:

```bash
npm install -g @binder.do/cli
binder init
```

## Installation

**From JetBrains Marketplace:**

1. Go to **Settings > Plugins > Marketplace**
2. Search for "Binder"
3. Click **Install** and restart

**From disk:**

1. Download the latest release from [GitHub Releases](https://github.com/mpazik/binder/releases)
2. Go to **Settings > Plugins > ⚙️ > Install Plugin from Disk...**
3. Select the downloaded ZIP file and restart

## Settings

Go to **Settings > Tools > Binder** to configure:

- **Binder executable path**: path to the `binder` command (default: `binder`)
- **Test Connection**: verifies the CLI is accessible and shows its version

## Usage

1. Open a folder that contains a `.binder` directory, or a parent folder with Binder workspaces in immediate subdirectories
2. The plugin activates automatically
3. Edit any `.md` or `.yaml` file — completions, diagnostics, and hints are live immediately
4. Save the file to sync changes to the knowledge graph

## Troubleshooting

### LSP server not starting

1. **Verify Binder is installed**: `binder --version`
2. **Check plugin settings**: **Settings > Tools > Binder**
3. **Test connection**: use the "Test Connection" button in settings
4. **Check IDE logs**: **Help > Show Log in Finder/Explorer**, look for errors containing `com.intellij.platform.lsp` or `binder`
5. **Verify workspace**: ensure your project has a `.binder` directory at the root or in an immediate subdirectory

### View LSP communication

1. Go to **Help > Diagnostic Tools > Debug Log Settings...**
2. Add: `#com.intellij.platform.lsp`
3. Click OK
4. Open a Markdown or YAML file in a Binder workspace
5. View logs: **Help > Show Log in Finder/Explorer**

## Building from Source

```bash
cd integrations/intellij-plugin

# Build the plugin
./gradlew buildPlugin

# Run a sandboxed IDE with the plugin loaded
./gradlew runIde

# The plugin ZIP will be in build/distributions/
```

## More Information

Visit [binder.do](https://binder.do) or the [GitHub repository](https://github.com/mpazik/binder).

## License

[MIT](../../LICENSE)
