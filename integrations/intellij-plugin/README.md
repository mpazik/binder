# Binder IntelliJ Plugin

Language Server Protocol support for [Binder](https://github.com/yourusername/binder) in IntelliJ-based IDEs.

## Features

- Real-time validation of Binder documents
- Automatic sync on save
- Error diagnostics with inline annotations
- Code actions and quick fixes
- Support for Markdown and YAML files in Binder workspaces

## Requirements

- IntelliJ IDEA 2025.1 or later (Community or Ultimate)
- Binder CLI must be installed

## Installation

### Install Binder CLI

```bash
# Install Binder (adjust for your installation method)
npm install -g binder
# or
brew install binder
```

### Install Plugin

1. Download the latest release from [GitHub Releases](https://github.com/yourusername/binder/releases)
2. In IntelliJ, go to **Settings > Plugins > ⚙️ > Install Plugin from Disk...**
3. Select the downloaded ZIP file
4. Restart IntelliJ

## Configuration

Go to **Settings > Tools > Binder** to configure:
- **Binder executable path**: Path to the `binder` command (default: `binder`)
- Click **Test Connection** to verify the Binder CLI is accessible

## Building from Source

```bash
# Clone the repository
git clone https://github.com/yourusername/binder-intellij-plugin.git
cd binder-intellij-plugin

# Build the plugin
./gradlew buildPlugin

# The plugin ZIP will be in build/distributions/
```

## Development

```bash
# Run IDE with plugin for testing
./gradlew runIde
```

## Debugging

### View LSP Communication

To see all messages exchanged between the IDE and Binder LSP server:

**Method 1: IDE Debug Logging** (Recommended)
1. Go to **Help > Diagnostic Tools > Debug Log Settings...**
2. Add: `#com.intellij.platform.lsp`
3. Click OK
4. Open a Markdown or YAML file in a Binder workspace
5. View logs: **Help > Show Log in Finder/Explorer**
6. Open `idea.log` - all LSP requests/responses are logged

**Method 2: Project LSP Logs**
1. Go to **Settings > Languages & Frameworks > Language Server Protocol**
2. Enable **"Log servers communications"**
3. This creates an `lsp/` directory in your project with detailed protocol logs

### Understanding LSP Logs

LSP logs show the JSON-RPC protocol messages:
- `-->` (client → server): Requests from IDE to Binder
- `<--` (server → client): Responses and notifications from Binder
- Look for `textDocument/didOpen`, `textDocument/didChange`, `textDocument/publishDiagnostics`, etc.

## Troubleshooting

### LSP Server Not Starting

1. **Verify Binder is installed**: `binder --version`
2. **Check plugin settings**: **Settings > Tools > Binder**
3. **Test connection**: Use the "Test Connection" button in settings
4. **Check IDE logs**: **Help > Show Log in Finder/Explorer**
   - Look for errors containing `com.intellij.platform.lsp` or `binder`
5. **Verify workspace**: Ensure your project has a `.binder` directory

### LSP Widget in Status Bar

The Binder widget appears in the status bar (bottom right) when:
- A Markdown or YAML file is open in a Binder workspace
- The LSP server is running

Click the widget to:
- View server status
- Open plugin settings
- Restart the LSP server

## License

MIT License - see [LICENSE](../LICENSE) file for details
