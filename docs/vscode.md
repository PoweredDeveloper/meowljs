# VS Code Syntax Highlighting

A minimal extension for `.meow` file syntax highlighting is in `vscode-meow/`.

## Installation

### Option 1: Run from source (development)

1. Open the `vscode-meow` folder in VS Code
2. Press **F5** to launch Extension Development Host
3. A new VS Code window opens with the extension loaded
4. Open any `.meow` file to see highlighting

### Option 2: Install as local extension

1. Copy the extension folder:
   ```bash
   cp -r vscode-meow ~/.vscode/extensions/meow-syntax-0.1.0
   ```
2. Reload VS Code (Cmd/Ctrl+Shift+P → "Developer: Reload Window")

### Option 3: Package and install

```bash
cd vscode-meow
npx @vscode/vsce package
code --install-extension meow-syntax-0.1.0.vsix
```

## Features

- Comments (`//`)
- Keywords: `function`, `component`, `use`, `import`, `if`, `each`, `end`, `prop`, `as`, `from`
- Strings and numbers
- HTML-like tags and attributes
- Embedded expressions `{...}`
- Divider `---`
- Bracket matching and auto-closing
