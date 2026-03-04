// compile.js
// Usage: node compile.js example.meow

const fs = require('fs')
const path = require('path')

// =====================================================
// CUSTOM ERRORS
// =====================================================

class MeowError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MeowError'
    Object.setPrototypeOf(this, MeowError.prototype)
  }
}

class MeowUsageError extends MeowError {
  constructor(message) {
    super(message)
    this.name = 'MeowUsageError'
  }
}

class MeowParseError extends MeowError {
  constructor(message, { file, line } = {}) {
    super(message)
    this.name = 'MeowParseError'
    this.file = file
    this.line = line
  }
}

class MeowFileError extends MeowError {
  constructor(message, file) {
    super(message)
    this.name = 'MeowFileError'
    this.file = file
  }
}

function exitWithError(err) {
  console.error(`${err.name}: ${err.message}`)
  process.exit(1)
}

const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf'])
const SAFE_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function validateIdentifier(name, context) {
  if (FORBIDDEN_NAMES.has(name)) {
    exitWithError(new MeowParseError(`Forbidden identifier: ${name}`, { file: context }))
  }
  if (!SAFE_IDENT.test(name)) {
    exitWithError(new MeowParseError(`Invalid identifier: ${name}`, { file: context }))
  }
}

function resolveInProject(filePath, baseDir) {
  const resolved = path.resolve(baseDir, filePath)
  let real
  try {
    real = fs.realpathSync(resolved)
  } catch (_) {
    exitWithError(new MeowFileError('File not found: ' + filePath, filePath))
  }
  const base = path.resolve(PROJECT_ROOT) + path.sep
  if (!real.startsWith(base) && real !== path.resolve(PROJECT_ROOT)) {
    exitWithError(new MeowFileError('Path outside project: ' + filePath, filePath))
  }
  return real
}

// =====================================================
// MAIN
// =====================================================

if (process.argv.length < 3) {
  exitWithError(new MeowUsageError('Usage: node compile.js <file.meow>'))
}

const PROJECT_ROOT = process.cwd()
const infile = path.resolve(PROJECT_ROOT, process.argv[2])
const BUILD_DIR = path.join(PROJECT_ROOT, 'build')

if (!path.resolve(PROJECT_ROOT, BUILD_DIR).startsWith(PROJECT_ROOT)) {
  exitWithError(new MeowFileError('Invalid build path', BUILD_DIR))
}
if (!fs.existsSync(BUILD_DIR)) fs.mkdirSync(BUILD_DIR)

let raw
try {
  raw = fs.readFileSync(infile, 'utf8')
} catch (e) {
  if (e.code === 'ENOENT') {
    exitWithError(new MeowFileError(`File not found: ${process.argv[2]}`, process.argv[2]))
  }
  throw e
}

const normalized = raw.replace(/«/g, '"').replace(/»/g, '"')

const parts = normalized.split(/^---\s*$/m)
if (parts.length < 2) {
  exitWithError(new MeowParseError('Missing --- divider between prelude and template.', { file: infile }))
}

const prelude = parts[0].trim()
let template = parts.slice(1).join('---').trim()

// remove // comments inside template
template = template.replace(/\/\/.*$/gm, '')

// Ruby-like blocks: if/end, each/end -> {#if}...{/if}, {#each}...{/each}
function convertRubyBlocks(html) {
  const lines = html.split('\n')
  const out = []
  const stack = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const indent = line.match(/^\s*/)[0] || ''

    const ifMatch = trimmed.match(/^if\s+(.+?)(?:\s+do)?\s*$/)
    const eachMatch = trimmed.match(/^each\s+(.+?)\s+as\s+([A-Za-z_$][\w$]*)(?:\s+do)?\s*$/)
    const endMatch = trimmed === 'end'

    if (ifMatch) {
      out.push(indent + `{#if ${ifMatch[1].trim()}}`)
      stack.push('if')
    } else if (eachMatch) {
      out.push(indent + `{#each ${eachMatch[1].trim()} as ${eachMatch[2]}}`)
      stack.push('each')
    } else if (endMatch && stack.length > 0) {
      const type = stack.pop()
      out.push(indent + `{/${type}}`)
    } else {
      out.push(line)
    }
  }

  if (stack.length > 0) {
    exitWithError(new MeowParseError(`Unclosed block: missing 'end' for ${stack[stack.length - 1]}`, { file: infile }))
  }
  return out.join('\n')
}

template = convertRubyBlocks(template)

// =====================================================
// PARSE STATE + HELPERS
// =====================================================

const stateLines = []
const stateKeys = []
const helperLines = []
const helperKeys = []
const componentLines = []
const componentKeys = []
const externalComponents = []
const externalComponentCode = []
const namespaceKeys = []

for (let line of prelude.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('//')) continue

  const useMatch = trimmed.match(/^use\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']\s*$/)
  if (useMatch) {
    validateIdentifier(useMatch[1], infile)
    const compPath = resolveInProject(useMatch[2], path.dirname(infile))
    externalComponents.push({ type: 'default', name: useMatch[1], path: compPath })
    continue
  }

  const importDefaultMatch = trimmed.match(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']\s*$/)
  if (importDefaultMatch) {
    validateIdentifier(importDefaultMatch[1], infile)
    const compPath = resolveInProject(importDefaultMatch[2], path.dirname(infile))
    externalComponents.push({ type: 'default', name: importDefaultMatch[1], path: compPath })
    continue
  }

  const importNamedMatch = trimmed.match(/^import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']\s*$/)
  if (importNamedMatch) {
    const names = importNamedMatch[1].split(',').map((n) => {
      const asMatch = n.trim().match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      return asMatch ? { from: asMatch[1], as: asMatch[2] } : { from: n.trim(), as: n.trim() }
    }).filter((n) => n.from)
    names.forEach((n) => { validateIdentifier(n.from, infile); validateIdentifier(n.as, infile) })
    const compPath = resolveInProject(importNamedMatch[2], path.dirname(infile))
    externalComponents.push({ type: 'named', names, path: compPath })
    continue
  }

  const importNamespaceMatch = trimmed.match(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']\s*$/)
  if (importNamespaceMatch) {
    validateIdentifier(importNamespaceMatch[1], infile)
    const compPath = resolveInProject(importNamespaceMatch[2], path.dirname(infile))
    externalComponents.push({ type: 'namespace', name: importNamespaceMatch[1], path: compPath })
    namespaceKeys.push(importNamespaceMatch[1])
    continue
  }

  const compFromMatch = trimmed.match(/^component\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']\s*$/)
  if (compFromMatch) {
    validateIdentifier(compFromMatch[1], infile)
    const compPath = resolveInProject(compFromMatch[2], path.dirname(infile))
    externalComponents.push({ type: 'default', name: compFromMatch[1], path: compPath })
    continue
  }

  const compMatch = trimmed.match(/^component\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/)
  if (compMatch) {
    validateIdentifier(compMatch[1], infile)
    const rhs = compMatch[2].trim()
    if (rhs.startsWith('<')) {
      const compCode = compileComponentTemplate(rhs, compMatch[1])
      componentLines.push(`component ${compMatch[1]} = __ext_${compMatch[1]}__`)
      externalComponentCode.push({ name: compMatch[1], code: compCode })
    } else {
      componentLines.push(line)
    }
    componentKeys.push(compMatch[1])
    continue
  }

  const m = trimmed.match(/^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/)
  if (m) {
    validateIdentifier(m[1], infile)
    stateLines.push(`state.${m[1]} = ${m[2]};`)
    stateKeys.push(m[1])
  } else {
    helperLines.push(line)
  }
}

// detect helper names
helperLines.forEach((line) => {
  const fn = line.match(/^\s*function\s+([A-Za-z_$][\w$]*)\s*=/)
  if (fn) {
    validateIdentifier(fn[1], infile)
    helperKeys.push(fn[1])
  }
  const cn = line.match(/^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/)
  if (cn) {
    validateIdentifier(cn[1], infile)
    helperKeys.push(cn[1])
  }
})

// =====================================================
// EXPRESSION TRANSFORM
// =====================================================

function transformExpression(expr, localVars = []) {
  return expr.replace(/\b[A-Za-z_$][\w$]*\b/g, (name) => {
    if (localVars.includes(name)) return name
    if (name === 'event') return 'event'

    if (stateKeys.includes(name)) return `state.${name}`
    if (helperKeys.includes(name)) return `helpers.${name}`
    if (componentKeys.includes(name)) return `components.${name}`
    if (namespaceKeys.includes(name)) return `components.${name}`

    return name
  })
}

// =====================================================
// TRANSFORM HELPERS
// =====================================================

let helpersCode = helperLines
  .join('\n')
  .replace(/^\s*function\s+([A-Za-z_$][\w$]*)\s*=\s*\(\)\s*=>/gm, (_, name) => `helpers.${name} = (state, helpers, event) =>`)
  .replace(/^\s*(const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm, (_, __, name) => `helpers.${name} =`)

// Protect LHS "helpers.NAME" from being doubled (e.g. helpers.printText -> helpers.helpers.printText)
helperKeys.forEach((name) => {
  helpersCode = helpersCode.replace(new RegExp(`helpers\\.${name}\\b`, 'g'), `__HELPER_LHS_${name}__`)
})

helpersCode = helpersCode.replace(/\b[A-Za-z_$][\w$]*\b/g, (name) => {
  if (stateKeys.includes(name)) return `state.${name}`
  if (helperKeys.includes(name)) return `helpers.${name}`
  return name
})

helperKeys.forEach((name) => {
  helpersCode = helpersCode.replace(new RegExp(`__HELPER_LHS_${name}__`, 'g'), `helpers.${name}`)
})

// =====================================================
// COMPONENTS
// =====================================================

let componentsCode = componentLines
  .join('\n')
  .replace(/^component\s+([A-Za-z_$][\w$]*)\s*=\s*/gm, (_, name) => `components.${name} = `)

componentKeys.forEach((name) => {
  componentsCode = componentsCode.replace(new RegExp(`components\\.${name}\\b`, 'g'), `__COMP_LHS_${name}__`)
})

componentsCode = componentsCode.replace(/\b[A-Za-z_$][\w$]*\b/g, (name) => {
  if (stateKeys.includes(name)) return `state.${name}`
  if (helperKeys.includes(name)) return `helpers.${name}`
  if (componentKeys.includes(name)) return `components.${name}`
  return name
})

componentKeys.forEach((name) => {
  componentsCode = componentsCode.replace(new RegExp(`__COMP_LHS_${name}__`, 'g'), `components.${name}`)
})

function compileComponentTemplate(html, componentName, defaultProps = null) {
  function escape(str) {
    return str.replace(/`/g, '\\`').replace(/\$/g, '\\$')
  }
  function transformProps(expr, localVars = []) {
    return expr.replace(/\b[A-Za-z_$][\w$]*\b/g, (name) => {
      if (localVars.includes(name)) return name
      if (name === 'event') return 'event'
      if (name === 'children') return 'children'
      return `props.${name}`
    })
  }

  let exprCounter = 0
  const exprFunctions = []

  const regex = /<\/[a-zA-Z0-9-]+>|<(?:[a-zA-Z0-9-]+)(?:\s+[a-zA-Z0-9-]+=(?:"[^"]*"|\{[^}]*\}))*\s*\/?>|\{#(if|each)(?:\s+([^}]*))?\}|\{\/(if|each)\}|{[^}]+}|[^<{]+/g
  const stack = []
  const root = { type: 'root', children: [] }
  stack.push(root)
  let match
  const fullHtml = convertRubyBlocks(html)
  while ((match = regex.exec(fullHtml))) {
    const token = match[0]
    if (token.startsWith('{#') && token.endsWith('}')) {
      const blockType = match[1]
      const blockContent = (match[2] || '').trim()
      if (blockType === 'if') {
        const node = { type: 'if', expr: blockContent, children: [] }
        stack[stack.length - 1].children.push(node)
        stack.push(node)
      } else if (blockType === 'each') {
        const asMatch = blockContent.match(/^(.+?)\s+as\s+([A-Za-z_$][\w$]*)$/)
        if (asMatch) {
          const node = { type: 'each', expr: asMatch[1].trim(), as: asMatch[2].trim(), children: [] }
          stack[stack.length - 1].children.push(node)
          stack.push(node)
        }
      }
    } else if (token === '{/if}' || token === '{/each}') {
      stack.pop()
    } else if (token.startsWith('{') && !token.startsWith('{#')) {
      stack[stack.length - 1].children.push({ type: 'expr', raw: token.slice(1, -1).trim() })
    } else if (token.startsWith('</')) {
      stack.pop()
    } else if (token.startsWith('<') && !token.startsWith('<!--')) {
      const tagMatch = token.match(/^<([a-zA-Z0-9-]+)/)
      if (tagMatch) {
        const node = { type: 'element', tag: tagMatch[1], raw: token, children: [] }
        stack[stack.length - 1].children.push(node)
        if (!token.endsWith('/>')) stack.push(node)
      }
    } else {
      stack[stack.length - 1].children.push({ type: 'text', value: token })
    }
  }

  const ast = stack[0]?.children?.[0] || root.children[0]
  if (!ast) return `components.${componentName} = () => h("div", {}, []);`

  function compileNode(node, localVars = []) {
    if (node.type === 'text') return `t(\`${escape(node.value)}\`)`
    if (node.type === 'expr') {
      const transformed = transformProps(node.raw, localVars)
      if (localVars.length > 0) return `t(String(${transformed}))`
      const id = exprCounter++
      exprFunctions.push(`const expr_${id} = (props, event) => (${transformed});`)
      return `t(String(expr_${id}(props)))`
    }
    if (node.type === 'if') {
      const transformed = transformProps(node.expr, localVars)
      const id = exprCounter++
      exprFunctions.push(`const expr_${id} = (props, event) => (${transformed});`)
      const inner = node.children.map((c) => compileNode(c, localVars)).join(',')
      return `expr_${id}(props) ? [${inner}] : []`
    }
    if (node.type === 'each') {
      const transformedExpr = transformProps(node.expr, localVars)
      const asVar = node.as
      const innerParts = node.children.map((c) => {
        const code = compileNode(c, [...localVars, asVar])
        return c.type === 'each' ? `...${code}` : code
      })
      return `(${transformedExpr}).map(${asVar} => [${innerParts.join(',')}])`
    }
    if (node.type === 'element') {
      const attrs = {}
      const staticRegex = /([a-zA-Z0-9-]+)="([^"]*)"/g
      let m
      while ((m = staticRegex.exec(node.raw))) attrs[m[1]] = JSON.stringify(m[2])
      const dynamicRegex = /([a-zA-Z0-9-]+)=\{([^}]+)\}/g
      while ((m = dynamicRegex.exec(node.raw))) {
        const name = m[1]
        const rawExpr = m[2].trim()
        const transformed = transformProps(rawExpr, localVars)
        if (name.startsWith('on')) {
          attrs[name] = transformed
        } else {
          const id = exprCounter++
          exprFunctions.push(`const expr_${id} = (props, event) => (${transformed});`)
          attrs[name] = `expr_${id}`
        }
      }
      const propsStr = `{ ${Object.entries(attrs).map(([k, v]) => `"${k}": ${v}`).join(',')} }`
      const children = node.children.map((c) => compileNode(c, localVars)).join(',')
      return `h("${node.tag}", ${propsStr}, [${children}])`
    }
  }

  const vnodeCode = compileNode(ast)
  const fnBody = exprFunctions.length
    ? `${exprFunctions.join('\n')}\nreturn ${vnodeCode};`
    : `return ${vnodeCode};`
  if (defaultProps && Object.keys(defaultProps).length) {
    const defaultsObj = `{ ${Object.entries(defaultProps).map(([k, v]) => `${k}: ${v}`).join(', ')} }`
    return `(props) => { const __p = Object.assign({}, ${defaultsObj}, props); ${fnBody.replace(/\bprops\b/g, '__p')} }`
  }
  return `(props) => { ${fnBody} }`
}

function loadMeowFile(filePath) {
  let extRaw
  try {
    extRaw = fs.readFileSync(filePath, 'utf8')
  } catch (e) {
    exitWithError(new MeowFileError(`Cannot load: ${filePath}`, filePath))
  }
  const raw = extRaw.replace(/«/g, '"').replace(/»/g, '"')

  const components = {}

  const blockParts = raw.split(/^\s*component\s+/m).filter((p) => p.trim())
  for (const part of blockParts) {
    const firstLine = part.split('\n')[0]
    const nameMatch = firstLine.match(/^([A-Za-z_$][\w$]*)\s*$/)
    if (!nameMatch) continue
    const name = nameMatch[1]
    validateIdentifier(name, filePath)
    const block = part.slice(firstLine.length).trim()
    const dashIdx = block.indexOf('---')
    const hasDivider = dashIdx >= 0
    const beforeDiv = hasDivider ? block.slice(0, dashIdx).trim() : ''
    const template = (hasDivider ? block.slice(dashIdx + 3).trim() : block).replace(/\/\/.*$/gm, '')
    const propLines = beforeDiv.split('\n').filter((l) => /^\s*prop\s+/.test(l))
    const defaultProps = {}
    for (const pl of propLines) {
      const pm = pl.trim().match(/^prop\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/)
      if (pm) {
        validateIdentifier(pm[1], filePath)
        defaultProps[pm[1]] = pm[2].trim()
      }
    }
    if (template) {
      components[name] = { type: 'template', html: template, defaultProps: Object.keys(defaultProps).length ? defaultProps : null }
    }
  }

  if (Object.keys(components).length === 0) {
    const extParts = raw.split(/^---\s*$/m)
    const extPrelude = (extParts[0] || '').trim()
    const extTemplate = (extParts.slice(1).join('---') || '').trim().replace(/\/\/.*$/gm, '')

    const compRegex = /^component\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/gm
    let m
    while ((m = compRegex.exec(extPrelude))) {
      validateIdentifier(m[1], filePath)
      components[m[1]] = { type: 'fn', def: m[2].trim() }
    }

    if (extTemplate && Object.keys(components).length === 0) {
      components.__default__ = { type: 'template', html: extTemplate, defaultProps: null }
    } else if (extTemplate) {
      const firstTag = extTemplate.match(/^<([a-zA-Z0-9-]+)/)
      const inferredName = firstTag ? firstTag[1].charAt(0).toUpperCase() + firstTag[1].slice(1) : null
      if (inferredName && !components[inferredName]) {
        components[inferredName] = { type: 'template', html: extTemplate, defaultProps: null }
      }
    }
  }

  return { components }
}

const namespaceDefs = []
const namespaceInits = []

// Load external components
for (const ext of externalComponents) {
  const isMeow = ext.path.endsWith('.meow')
  if (!isMeow) {
    exitWithError(new MeowParseError(`Import only supports .meow files: ${ext.path}`, { file: infile }))
  }

  const loaded = loadMeowFile(ext.path)

  if (ext.type === 'default') {
    const comp = loaded.components[ext.name] || loaded.components.__default__
    if (!comp) {
      const available = Object.keys(loaded.components).filter((k) => k !== '__default__').join(', ') || '(none)'
      exitWithError(new MeowParseError(`Component '${ext.name}' not found in ${ext.path}. Available: ${available}`, { file: ext.path }))
    }
    if (comp.type === 'fn') {
      componentLines.push(`component ${ext.name} = ${comp.def}`)
    } else {
      const compCode = compileComponentTemplate(comp.html, ext.name, comp.defaultProps)
      componentLines.push(`component ${ext.name} = __ext_${ext.name}__`)
      externalComponentCode.push({ name: ext.name, code: compCode })
    }
    if (!componentKeys.includes(ext.name)) componentKeys.push(ext.name)
  } else if (ext.type === 'named') {
    for (const { from, as: alias } of ext.names) {
      const comp = loaded.components[from]
      if (!comp) {
        const available = Object.keys(loaded.components).filter((k) => k !== '__default__').join(', ') || '(none)'
        exitWithError(new MeowParseError(`Component '${from}' not found in ${ext.path}. Available: ${available}`, { file: ext.path }))
      }
      const name = alias
      if (comp.type === 'fn') {
        componentLines.push(`component ${name} = ${comp.def}`)
      } else {
        const compCode = compileComponentTemplate(comp.html, name, comp.defaultProps)
        componentLines.push(`component ${name} = __ext_${name}__`)
        externalComponentCode.push({ name, code: compCode })
      }
      if (!componentKeys.includes(name)) componentKeys.push(name)
    }
  } else if (ext.type === 'namespace') {
    const nsEntries = []
    for (const [name, comp] of Object.entries(loaded.components)) {
      if (name === '__default__') continue
      const extKey = `__ext_${ext.name}_${name}__`
      if (comp.type === 'fn') {
        namespaceDefs.push({ varName: extKey, def: comp.def })
      } else {
        const compCode = compileComponentTemplate(comp.html, name, comp.defaultProps)
        externalComponentCode.push({ name: extKey, code: compCode, varName: extKey })
      }
      nsEntries.push(`${name}: ${extKey}`)
    }
    namespaceInits.push({ name: ext.name, entries: nsEntries.join(', ') })
  }
}

// Rebuild componentsCode with external components
componentsCode = componentLines
  .join('\n')
  .replace(/^component\s+([A-Za-z_$][\w$]*)\s*=\s*/gm, (_, name) => `components.${name} = `)

componentKeys.forEach((name) => {
  componentsCode = componentsCode.replace(new RegExp(`components\\.${name}\\b`, 'g'), `__COMP_LHS_${name}__`)
})

componentsCode = componentsCode.replace(/\b[A-Za-z_$][\w$]*\b/g, (name) => {
  if (stateKeys.includes(name)) return `state.${name}`
  if (helperKeys.includes(name)) return `helpers.${name}`
  if (componentKeys.includes(name)) return `components.${name}`
  return name
})

componentKeys.forEach((name) => {
  componentsCode = componentsCode.replace(new RegExp(`__COMP_LHS_${name}__`, 'g'), `components.${name}`)
})

// =====================================================
// TEMPLATE COMPILER
// =====================================================

function compileTemplate(html) {
  function escape(str) {
    return str.replace(/`/g, '\\`').replace(/\$/g, '\\$')
  }

  let exprCounter = 0
  const exprFunctions = []

  function parse(html) {
    const stack = []
    const root = { type: 'root', children: [] }
    stack.push(root)

    const regex = /<\/[a-zA-Z0-9-]+>|<(?:[a-zA-Z0-9-]+)(?:\s+[a-zA-Z0-9-]+=(?:"[^"]*"|\{[^}]*\}))*\s*\/?>|\{#(if|each)(?:\s+([^}]*))?\}|\{\/(if|each)\}|{[^}]+}|[^<{]+/g
    let match

    while ((match = regex.exec(html))) {
      const token = match[0]

      if (token.startsWith('{#') && token.endsWith('}')) {
        const blockType = match[1]
        const blockContent = (match[2] || '').trim()

        if (blockType === 'if') {
          const node = { type: 'if', expr: blockContent, children: [] }
          stack[stack.length - 1].children.push(node)
          stack.push(node)
        } else if (blockType === 'each') {
          const asMatch = blockContent.match(/^(.+?)\s+as\s+([A-Za-z_$][\w$]*)$/)
          if (!asMatch) continue
          const node = { type: 'each', expr: asMatch[1].trim(), as: asMatch[2].trim(), children: [] }
          stack[stack.length - 1].children.push(node)
          stack.push(node)
        }
      } else if (token === '{/if}' || token === '{/each}') {
        stack.pop()
      } else if (token.startsWith('{') && !token.startsWith('{#')) {
        stack[stack.length - 1].children.push({
          type: 'expr',
          raw: token.slice(1, -1).trim(),
        })
      } else if (token.startsWith('</')) {
        stack.pop()
      } else if (token.startsWith('<')) {
        if (token.startsWith('<!--')) continue

        const tagMatch = token.match(/^<([a-zA-Z0-9-.]+)/)
        if (!tagMatch) continue

        const tag = tagMatch[1]

        const node = {
          type: 'element',
          tag,
          raw: token,
          children: [],
        }

        stack[stack.length - 1].children.push(node)

        if (!token.endsWith('/>')) stack.push(node)
      } else {
        stack[stack.length - 1].children.push({
          type: 'text',
          value: token,
        })
      }
    }

    return root.children[0]
  }

  function compileNode(node, localVars = []) {
    if (node.type === 'text') {
      return `t(\`${escape(node.value)}\`)`
    }

    if (node.type === 'expr') {
      const transformed = transformExpression(node.raw, localVars)
      if (localVars.length > 0) {
        return `t(String(${transformed}))`
      }
      const id = exprCounter++
      exprFunctions.push(`const expr_${id} = (state, helpers, event) => (${transformed});`)
      return `t(String(expr_${id}(state, helpers)))`
    }

    if (node.type === 'if') {
      const transformed = transformExpression(node.expr, localVars)
      const id = exprCounter++
      exprFunctions.push(`const expr_${id} = (state, helpers, event) => (${transformed});`)
      const inner = node.children.map((c) => compileNode(c, localVars)).join(',')
      return `expr_${id}(state, helpers) ? [${inner}] : []`
    }

    if (node.type === 'each') {
      const transformedExpr = transformExpression(node.expr, localVars)
      const asVar = node.as
      const innerParts = node.children.map((c) => {
        const code = compileNode(c, [...localVars, asVar])
        return c.type === 'each' ? `...${code}` : code
      })
      const inner = innerParts.join(',')
      return `(${transformedExpr}).map(${asVar} => [${inner}])`
    }

    if (node.type === 'element') {
      const tag = node.tag
      const isNamespaceComp = tag.includes('.') && namespaceKeys.includes(tag.split('.')[0])
      const isComponent = isNamespaceComp || componentKeys.includes(tag)
      const props = compileProps(node, localVars)
      const children = node.children.map((c) => compileNode(c, localVars)).join(',')

      if (isComponent) {
        return `h(components.${tag}, ${props}, [${children}])`
      }

      return `h("${tag}", ${props}, [${children}])`
    }
  }

  function compileProps(node, localVars) {
    const attrs = {}

    // Static: attr="value"
    const staticRegex = /([a-zA-Z0-9-]+)="([^"]*)"/g
    let m
    while ((m = staticRegex.exec(node.raw))) {
      attrs[m[1]] = JSON.stringify(m[2])
    }

    // Dynamic: attr={expr} (overrides static if same name)
    const dynamicRegex = /([a-zA-Z0-9-]+)=\{([^}]+)\}/g
    while ((m = dynamicRegex.exec(node.raw))) {
      const name = m[1]
      const rawExpr = m[2].trim()
      const transformed = transformExpression(rawExpr, localVars)
      const id = exprCounter++

      if (name.startsWith('on')) {
        const bareHelper = transformed.match(/^helpers\.([A-Za-z_$][\w$]*)$/)
        const callExpr = bareHelper && !/[=(]/.test(rawExpr)
          ? `(${transformed})(state, helpers, event)`
          : transformed
        exprFunctions.push(`const expr_${id} = (state, helpers, event) => { ${callExpr}; };`)
      } else {
        exprFunctions.push(`const expr_${id} = (state, helpers, event) => (${transformed});`)
      }

      attrs[name] = `expr_${id}`
    }

    return `{ ${Object.entries(attrs)
      .map(([k, v]) => `"${k}": ${v}`)
      .join(',')} }`
  }

  const ast = parse(html)
  const vnodeCode = compileNode(ast)

  return `
${exprFunctions.join('\n')}

function render(state, helpers){
  return ${vnodeCode};
}
`
}

const renderCode = compileTemplate(template)

// =====================================================
// RUNTIME
// =====================================================

const runtime = `
"use strict";

(function(){

const root = document.getElementById("root");

function h(tag, props, children){
  return { tag, props, children };
}

function t(text){
  return { text };
}

function createDom(vnode){

  if(Array.isArray(vnode)){
    const frag = document.createDocumentFragment();
    vnode.forEach(v => frag.appendChild(createDom(v)));
    return frag;
  }

  if(vnode.text !== undefined){
    return document.createTextNode(vnode.text);
  }

  if(typeof vnode.tag === "function"){
    const props = {};
    for(const key in vnode.props){
      const val = vnode.props[key];
      if(key.startsWith("on")) props[key] = val;
      else props[key] = typeof val === "function" ? val(proxy, helpers) : val;
    }
    const child = vnode.tag(props, vnode.children);
    return createDom(child);
  }

  const el = document.createElement(vnode.tag);

  const UNSAFE_ATTRS = ["href","src","action","formaction","xlink:href"];
  const UNSAFE_PREFIXES = ["javascript:","data:text/html","vbscript:"];

  for(const key in vnode.props){
    if(key === "key") continue;
    if(key.startsWith("on")){
      const event = key.slice(2).toLowerCase();
      el.addEventListener(event, e => vnode.props[key](proxy, helpers, e));
    } else {
      let value = typeof vnode.props[key] === "function" ? vnode.props[key](proxy, helpers) : vnode.props[key];
      if (typeof value === "string" && UNSAFE_ATTRS.includes(key.toLowerCase())) {
        const v = value.trim().toLowerCase();
        if (UNSAFE_PREFIXES.some(p => v.startsWith(p))) value = "#";
      }
      el.setAttribute(key, value);
    }
  }

  vnode.children.forEach(c => el.appendChild(createDom(c)));

  return el;
}

function getFocusState(){
  const el = document.activeElement;
  if (!el || !root.contains(el)) return null;
  const path = [];
  let node = el;
  while (node && node !== root){
    const parent = node.parentNode;
    if (!parent) return null;
    path.unshift(Array.from(parent.childNodes).indexOf(node));
    node = parent;
  }
  const state = { path };
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA"){
    state.selectionStart = el.selectionStart;
    state.selectionEnd = el.selectionEnd;
  }
  return state;
}

function restoreFocus(state){
  if (!state) return;
  let el = root;
  for (const i of state.path){
    el = el.childNodes[i];
    if (!el) return;
  }
  el.focus();
  if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && state.selectionStart != null){
    el.setSelectionRange(state.selectionStart, state.selectionEnd);
  }
}

function patch(newVNode){
  const focusState = getFocusState();
  root.innerHTML = "";
  root.appendChild(createDom(newVNode));
  restoreFocus(focusState);
}

const state = {};
${stateLines.join('\n')}

const helpers = {};
(function(helpers,state){
${helpersCode}
})(helpers,state);

${externalComponentCode.map(c => c.varName ? `const ${c.varName} = ${c.code};` : `const __ext_${c.name}__ = ${c.code};`).join('\n')}
${namespaceDefs.map(d => `const ${d.varName} = ${d.def};`).join('\n')}
const components = {};
(function(components,helpers,state){
${componentsCode}
})(components,helpers,state);
${namespaceInits.map(n => `components.${n.name} = { ${n.entries} };`).join('\n')}

${renderCode}

function rerender(){
  patch(render(proxy, helpers));
}

const proxy = new Proxy(state,{
  set(obj,prop,value){
    obj[prop]=value;
    rerender();
    return true;
  }
});

window.MEOW = { state: proxy, helpers, components };

rerender();

})();
`

async function minify(code) {
  if (process.env.MEOW_DEBUG) return code
  try {
    const { minify: terserMinify } = require('terser')
    const result = await terserMinify(code, {
      compress: { passes: 2 },
      mangle: { toplevel: true },
      format: { comments: false }
    })
    return result.code || code
  } catch (_) {
    return code.replace(/\n\s*\n/g, '\n').replace(/^\s+|\s+$/gm, '')
  }
}

async function build() {
  const minified = await minify(runtime)
  fs.writeFileSync(path.join(BUILD_DIR, 'bundle.js'), minified)

  const indexPath = path.join(PROJECT_ROOT, 'index.html')
  let rootIndex
  try {
    rootIndex = fs.readFileSync(indexPath, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') {
      exitWithError(new MeowFileError('index.html not found in project root.', 'index.html'))
    }
    throw e
  }

  const buildIndex = rootIndex.replace('</body>', `<script src="./bundle.js"></script></body>`)
  fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), buildIndex)

  const faviconPath = path.join(PROJECT_ROOT, 'favicon.svg')
  if (fs.existsSync(faviconPath)) {
    fs.copyFileSync(faviconPath, path.join(BUILD_DIR, 'favicon.svg'))
  }
  const stylesPath = path.join(PROJECT_ROOT, 'styles.css')
  if (fs.existsSync(stylesPath)) {
    fs.copyFileSync(stylesPath, path.join(BUILD_DIR, 'styles.css'))
  }

  console.log('Build complete.')
}

build().catch(e => { console.error(e); process.exit(1) })
