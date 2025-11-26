# Binder for VS Code

Language support for Binder - a Git-inspired knowledge graph system for Markdown files.

## Features

- **Automatic Sync on Save**: Automatically synchronizes your Markdown and YAML files with the Binder knowledge graph when you save them
- **Real-time Diagnostics**: Shows error messages inline when synchronization fails
- **Seamless Integration**: Works transparently in the background - just save your files

## Requirements

- Binder CLI must be installed and accessible in your PATH
- Your project must be a Binder workspace (contains a `.binder` directory)

To initialize a Binder workspace, run:
```bash
binder init
```

## Extension Settings

This extension contributes the following settings:

- `binder.cliPath`: Path to the binder executable (default: `"binder"`)
- `binder.trace.server`: Enable tracing of communication between VS Code and the language server (default: `"off"`)

## Usage

1. Open a folder that contains a `.binder` directory (a Binder workspace)
2. The extension will activate automatically
3. Edit any `.md` or `.yaml` file
4. Save the file - it will be automatically synchronized with the knowledge graph
5. If sync fails, you'll see diagnostic messages in the editor

## Troubleshooting

### How to check if the LSP server is running

1. Open the Output panel (View → Output or Cmd+Shift+U)
2. Select "Binder LSP" from the dropdown
3. You should see server logs indicating the connection status

### Configure custom CLI path

If Binder CLI is not in your PATH, you can configure a custom path:

1. Open Settings (Cmd+,)
2. Search for "binder.cliPath"
3. Set the absolute path to your binder executable

### Extension not activating

Make sure your workspace contains a `.binder` directory. The extension only activates when it detects a Binder workspace.

## More Information

For more information about Binder, visit the [Binder repository](https://github.com/binder/binder).
