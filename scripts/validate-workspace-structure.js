#!/usr/bin/env node
/**
 * Validates workspace structure against best practices:
 * - Shared tools (TypeScript, ESLint, etc.) should be in root only
 * - Runtime deps should be in their respective workspace
 * - Avoid duplication where possible
 * 
 * Usage: node scripts/validate-workspace-structure.js
 */

const fs = require('fs');
const path = require('path');

// Packages that SHOULD ONLY be in root (shared tools)
const SHARED_ONLY = new Set([
  'typescript',
  'eslint',
  'prettier',
  'husky',
  'lint-staged',
  '@typescript-eslint/eslint-plugin',
  '@typescript-eslint/parser',
]);

// Packages that should NOT be in root (workspace-specific)
const WORKSPACE_ONLY = new Set([
  'react',
  'react-dom',
  'express',
  'cors',
  'dotenv',
]);

let rootPkg;
try {
  rootPkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
} catch (err) {
  console.error('❌ Error reading root package.json:', err.message);
  process.exit(1);
}

const workspaceDirs = rootPkg.workspaces || [];
const warnings = [];

// Check each workspace
workspaceDirs.forEach((workspace) => {
  const pkgPath = path.join(workspace, 'package.json');
  if (!fs.existsSync(pkgPath)) return;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    console.error(`❌ Error reading ${workspace}/package.json`);
    return;
  }

  const wsDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const wsName = path.basename(workspace);

  // Rule 1: Shared tools should not be in workspace devDependencies
  Object.keys(wsDeps).forEach((dep) => {
    if (SHARED_ONLY.has(dep)) {
      warnings.push(
        `⚠️  "${dep}" in ${wsName} should be in root only (shared tool)`
      );
    }
  });

  // Rule 2: Runtime deps should not be in root
  if (pkg.dependencies) {
    Object.keys(pkg.dependencies).forEach((dep) => {
      if (WORKSPACE_ONLY.has(dep) && rootPkg.dependencies?.[dep]) {
        warnings.push(
          `⚠️  "${dep}" in both root and ${wsName} — consider moving to ${wsName} only`
        );
      }
    });
  }
});

if (warnings.length === 0) {
  console.log('✅ Workspace structure is valid');
  process.exit(0);
}

console.log(`\n📋 Found ${warnings.length} structural issue(s):\n`);
warnings.forEach((w) => console.log(w));
console.log();

process.exit(0); // Warnings only, don't fail the build
