#!/usr/bin/env node
'use strict'

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const c = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

const MEOW = `
  ${c.cyan('◆')} ${c.bold('MeowJS')} — minimal reactive UI
`

function runCompiler(entry, cwd) {
  return new Promise((resolve, reject) => {
    const compilerPath = path.join(__dirname, 'compiler.js')
    const child = spawn(process.execPath, [compilerPath, entry || 'main.meow'], {
      cwd: cwd || process.cwd(),
      stdio: 'inherit',
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Build failed with code ${code}`))))
  })
}

function createProject(name) {
  const dir = path.resolve(process.cwd(), name || '.')
  const templateDir = path.join(__dirname, 'templates', 'starter')

  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    console.error(`\n${c.yellow('!')} Directory ${dir} already exists and is not empty.\n`)
    process.exit(1)
  }

  fs.mkdirSync(dir, { recursive: true })

  function copyRecursive(src, dest) {
    const stat = fs.statSync(src)
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true })
      for (const name of fs.readdirSync(src)) {
        copyRecursive(path.join(src, name), path.join(dest, name))
      }
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
    }
  }
  copyRecursive(templateDir, dir)

  console.log(MEOW)
  console.log(`  ${c.green('✓')} Created project in ${c.cyan(path.relative(process.cwd(), dir) || '.')}\n`)
  console.log(`  ${c.dim('Next:')}`)
  console.log(`    cd ${name || '.'}`)
  console.log(`    ${c.cyan('meow dev')}    — start dev server`)
  console.log(`    ${c.cyan('meow build')}  — build for production\n`)
}

async function dev(entry, cwd) {
  const root = cwd || process.cwd()
  const entryFile = entry || 'main.meow'

  console.log(MEOW)
  console.log(`  ${c.dim('Watching')} ${entryFile}\n`)

  let building = false
  let pending = false

  const build = async () => {
    if (building) {
      pending = true
      return
    }
    building = true
    try {
      await runCompiler(entryFile, root)
      console.log(`  ${c.green('✓')} Built at ${new Date().toLocaleTimeString()}\n`)
    } catch (e) {
      console.error(`  ${c.yellow('✗')} ${e.message}\n`)
    }
    building = false
    if (pending) {
      pending = false
      build()
    }
  }

  await build()

  const chokidar = require('chokidar')
  const watcher = chokidar.watch([path.join(root, '**/*.meow'), path.join(root, 'index.html')], {
    ignored: /node_modules/,
    cwd: root,
  })

  watcher.on('change', () => build())

  const handler = require('serve-handler')
  const http = require('http')
  const server = http.createServer((req, res) =>
    handler(req, res, { public: path.join(root, 'build') }).catch((err) => {
      res.statusCode = 500
      res.end(err.message)
    }),
  )
  const port = 3000
  server.listen(port, () => {
    console.log(`  ${c.green('→')} http://localhost:${port}\n`)
  })
}

async function build(entry, cwd) {
  console.log(MEOW)
  await runCompiler(entry || 'main.meow', cwd || process.cwd())
}

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]
  const arg = args[1]

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(MEOW)
    console.log(`
  ${c.bold('Usage:')}
    npx meow create [name]   Create a new project
    npx meow dev [entry]     Start dev server (default: main.meow)
    npx meow build [entry]   Build for production (default: main.meow)

  ${c.bold('Examples:')}
    ${c.cyan('npx meow create my-app')}     Create project in ./my-app
    ${c.cyan('npx meow create')}            Create project in current directory
    ${c.cyan('npx meow dev')}               Start dev server
    ${c.cyan('npx meow build')}             Build main.meow
    ${c.cyan('npx meow build app.meow')}    Build app.meow
`)
    return
  }

  try {
    switch (cmd) {
      case 'create':
      case 'init':
      case 'new':
        createProject(arg)
        break
      case 'dev':
        await dev(arg, process.cwd())
        break
      case 'build':
        await build(arg, process.cwd())
        break
      default:
        console.error(`\n${c.yellow('!')} Unknown command: ${cmd}\n`)
        process.exit(1)
    }
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}

main()
