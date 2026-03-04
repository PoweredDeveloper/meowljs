# Meow Reference

## Runtime API

The compiled app exposes `window.MEOW`:

```javascript
MEOW.state // Proxy over state — assign to trigger re-render
MEOW.helpers // Helper functions
MEOW.components // Component functions (if any)
```

Example (from console or external script):

```javascript
MEOW.state.counter = 100
MEOW.helpers.printText()
```

## Requirements

- **index.html** in the project root with `<div id="root"></div>` in the body
- Compiler runs in Node.js (no extra dependencies)
- Run `npm install` for minification (terser); without it, the bundle is still built but not minified

## Compiler Errors

| Error            | Cause                                             |
| ---------------- | ------------------------------------------------- |
| `MeowUsageError` | Wrong CLI usage (e.g. no file argument)           |
| `MeowFileError`  | `.meow` file or `index.html` not found            |
| `MeowParseError` | Missing `---` divider, unclosed block, invalid id |

## Security

- **Identifiers**: Names like `__proto__`, `constructor`, `prototype` are rejected
- **Paths**: `use X from` paths must resolve within the project directory
- **Attributes**: `href`, `src`, `action`, etc. are sanitized — `javascript:`, `data:text/html`, `vbscript:` URLs are replaced with `#`
- **Text output**: Uses `createTextNode` (no raw HTML injection)
