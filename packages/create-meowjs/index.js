#!/usr/bin/env node
"use strict"

const { spawnSync } = require('child_process')
const path = require('path')

const projectName = process.argv[2] || ''
const cliPath = require.resolve('meowjs/cli.js')
const result = spawnSync(process.execPath, [cliPath, 'create', projectName], {
  stdio: 'inherit',
  cwd: process.cwd(),
})
process.exit(result.status || 0)
