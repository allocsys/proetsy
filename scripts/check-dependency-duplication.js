#!/usr/bin/env node
/**
 * Detects when the same package appears in multiple workspace package.json files
 * with different versions or unnecessary duplication.
 * 
 * Usage: node scripts/check-dependency-duplication.js
 * Exit code: 0 if clean, 1 if duplicates found
 */

const fs = require('fs');
const path = require('path');

// Read root package.json to find workspaces
let rootPkg;
try {
  rootPkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
} catch (err) {
  console.error('❌ Error reading root package.json:', err.message);
  process.exit(1);
}

const workspaceDirs = rootPkg.workspaces || [];

const allDeps = new Map(); // packageName -> [{ workspace, version, type }]
let hasErrors = false;

// Helper to record a dependency
function recordDep(workspace, name, version, type) {
  if (!allDeps.has(name)) {
    allDeps.set(name, []);
  }
  allDeps.get(name).push({ workspace, version, type });
}

// Scan root package.json
const rootDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
Object.entries(rootDeps).forEach(([name, version]) => {
  const type = rootPkg.dependencies?.[name] ? 'prod' : 'dev';
  recordDep('root', name, version, type);
});

// Scan each workspace
workspaceDirs.forEach((workspace) => {
  const pkgPath = path.join(workspace, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.warn(`⚠️  Workspace path not found: ${workspace}`);
    return;
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    console.error(`❌ Error reading ${workspace}/package.json:`, err.message);
    process.exit(1);
  }

  const wsName = path.basename(workspace);
  const wsDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  Object.entries(wsDeps).forEach(([name, version]) => {
    const type = pkg.dependencies?.[name] ? 'prod' : 'dev';
    recordDep(wsName, name, version, type);
  });
});

// Analyze for duplicates and version mismatches
const issues = [];

allDeps.forEach((locations, packageName) => {
  if (locations.length <= 1) return; // Single location is fine

  // Check if it's truly a duplicate
  const versions = new Set(locations.map((l) => l.version));
  const workspaces = new Set(locations.map((l) => l.workspace));

  // Case 1: Same package in multiple workspaces with DIFFERENT versions → ERROR
  if (versions.size > 1 && !packageName.startsWith('@')) {
    issues.push({
      level: 'error',
      package: packageName,
      message: `appears in multiple workspaces with DIFFERENT versions`,
      locations,
    });
  }

  // Case 2: Same package in root AND a workspace (usually duplication) → WARN
  if (workspaces.has('root') && workspaces.size > 1) {
    // Exception: allow if it's a workspace-specific override with same version
    if (versions.size === 1) {
      issues.push({
        level: 'warn',
        package: packageName,
        message: `defined in both root and workspace (same version) — remove from workspace if shared`,
        locations,
      });
    } else {
      issues.push({
        level: 'error',
        package: packageName,
        message: `defined in both root and workspace with DIFFERENT versions`,
        locations,
      });
    }
  }
});

// Print results
if (issues.length === 0) {
  console.log('✅ No dependency duplication issues found');
  process.exit(0);
}

console.log(`\n📋 Found ${issues.length} dependency issue(s):\n`);

let errorCount = 0;
issues.forEach(({ level, package: pkg, message, locations }) => {
  const icon = level === 'error' ? '❌' : '⚠️';
  console.log(`${icon} ${pkg}`);
  console.log(`   ${message}`);
  locations.forEach(({ workspace, version, type }) => {
    console.log(`   - ${workspace}: ${version} (${type})`);
  });
  console.log();

  if (level === 'error') errorCount++;
});

if (errorCount > 0) {
  console.error(`\n❌ ${errorCount} critical issue(s) found. Please fix before merging.`);
  process.exit(1);
} else {
  console.warn(`\n⚠️  ${issues.length} warning(s) found. Please review.`);
  process.exit(0); // Don't fail on warnings
}
