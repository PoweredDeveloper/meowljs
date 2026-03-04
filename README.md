# MeowJS

A minimal reactive UI framework. Write `.meow` files, compile to JavaScript, get a live-updating app.

## Quick Start

**Create a new project:**

```bash
npx meowjs create my-app
cd my-app
npm install
npx meowjs dev
```

**Or in an existing project:**

```bash
npm install meowjs
npx meowjs dev      # Start dev server with watch
npx meowjs build    # Build for production
```

Then open http://localhost:3000 (dev) or `build/index.html` (build).

## Project Structure

```
meowjs/
├── cli.js            # CLI (create, dev, build)
├── compiler.js       # Compiler (run with Node)
├── main.meow         # Your app: prelude + template
├── index.html        # Shell (must have <div id="root"></div>)
├── templates/        # Project template for meow create
├── docs/             # Documentation
├── vscode-meow/      # VS Code syntax highlighting
└── build/
    ├── bundle.js     # Compiled output
    └── index.html    # Build output
```

## CLI

| Command              | Description                      |
| -------------------- | -------------------------------- |
| `meow create [name]` | Create a new project             |
| `meow dev [entry]`   | Start dev server (watch + serve) |
| `meow build [entry]` | Build for production             |

Use via `npx meowjs` or install globally: `npm i -g meowjs`

## Documentation

| Doc                            | Description                                |
| ------------------------------ | ------------------------------------------ |
| [CLI](docs/cli.md)             | create, dev, build commands                |
| [Syntax](docs/syntax.md)       | File format, prelude, template, components |
| [Reference](docs/reference.md) | Runtime API, errors, security              |
| [VS Code](docs/vscode.md)      | Syntax highlighting extension              |

## TL;DR

```meow
counter = 0

function increment = () => { counter = counter + 1 }

---

<div>
  <h1>{counter}</h1>
  <button onClick={increment}>+1</button>
</div>
```
