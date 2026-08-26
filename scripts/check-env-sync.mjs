#!/usr/bin/env node
/**
 * Checks that every process.env / NEXT_PUBLIC_ variable referenced in the
 * codebase is documented in .env.example.
 *
 * Usage:
 *   node scripts/check-env-sync.mjs
 *
 * Exit codes:
 *   0 - All environment variables are documented
 *   1 - Missing or undocumented variables found
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = join(fileURLToPath(import.meta.url), "..", "..");
const ENV_EXAMPLE_PATH = join(ROOT_DIR, ".env.example");
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".git",
  "public/bb", // Minified browser bundle
]);

// Environment variables provided by the platform/framework
const SYSTEM_ENV_VARS = new Set([
  "NODE_ENV",
  "NEXT_RUNTIME",
  "DEBUG", // Used in browser bundles
]);

/**
 * Recursively collect all source files
 */
function collectFiles(dir, extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".jsx"])) {
  const files = [];
  
  function walk(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const relativePath = relative(ROOT_DIR, fullPath);
      
      // Skip excluded directories
      if (entry.isDirectory()) {
        const shouldSkip = [...EXCLUDE_DIRS].some(
          (exclude) => relativePath === exclude || relativePath.startsWith(exclude + "/")
        );
        if (!shouldSkip) {
          walk(fullPath);
        }
        continue;
      }
      
      // Only process files with matching extensions
      if (extensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
        files.push(fullPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

/**
 * Extract all process.env references from a file
 */
function extractEnvVars(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const envVars = new Set();
  
  // Match process.env.VAR_NAME
  const processEnvPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
  let match;
  while ((match = processEnvPattern.exec(content)) !== null) {
    envVars.add(match[1]);
  }
  
  // Match NEXT_PUBLIC_ variables (even without process.env prefix)
  const nextPublicPattern = /\b(NEXT_PUBLIC_[A-Z_][A-Z0-9_]*)\b/g;
  while ((match = nextPublicPattern.exec(content)) !== null) {
    envVars.add(match[1]);
  }
  
  // Match dynamic access patterns like process.env[key]
  // These are handled separately and shouldn't fail the check
  const dynamicPattern = /process\.env\s*\[/g;
  const dynamicMatches = content.match(dynamicPattern);
  if (dynamicMatches) {
    console.log(`  ℹ️  ${relative(ROOT_DIR, filePath)}: uses dynamic process.env access (skipped)`);
  }
  
  return envVars;
}

/**
 * Extract all documented variables from .env.example
 */
function extractDocumentedVars() {
  const content = readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  const documented = new Set();
  
  // Match variable names in the format VAR_NAME= or VAR_NAME =
  const pattern = /^([A-Z_][A-Z0-9_]*)=/gm;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    documented.add(match[1]);
  }
  
  return documented;
}

/**
 * Main check function
 */
function checkEnvSync() {
  console.log("🔍 Checking environment variable documentation...\n");
  
  // Collect all source files
  const sourceFiles = collectFiles(ROOT_DIR);
  console.log(`📁 Found ${sourceFiles.length} source files\n`);
  
  // Extract all env vars from code
  const allEnvVars = new Map(); // envVar -> Set of files
  for (const file of sourceFiles) {
    const envVars = extractEnvVars(file);
    for (const envVar of envVars) {
      if (!allEnvVars.has(envVar)) {
        allEnvVars.set(envVar, new Set());
      }
      allEnvVars.get(envVar).add(relative(ROOT_DIR, file));
    }
  }
  
  // Extract documented vars from .env.example
  const documentedVars = extractDocumentedVars();
  console.log(`📝 Found ${documentedVars.size} variables in .env.example\n`);
  
  // Find missing variables
  const missingVars = [];
  for (const [envVar, files] of allEnvVars) {
    // Skip system variables
    if (SYSTEM_ENV_VARS.has(envVar)) {
      continue;
    }
    
    if (!documentedVars.has(envVar)) {
      missingVars.push({ envVar, files: [...files] });
    }
  }
  
  // Report results
  if (missingVars.length === 0) {
    console.log("✅ All environment variables are documented in .env.example");
    return true;
  }
  
  console.log(`❌ Found ${missingVars.length} undocumented environment variable(s):\n`);
  for (const { envVar, files } of missingVars) {
    console.log(`  ${envVar}`);
    console.log(`    Used in:`);
    for (const file of files) {
      console.log(`      - ${file}`);
    }
    console.log();
  }
  
  console.log("💡 Add these variables to .env.example with appropriate documentation");
  console.log("   (purpose, required/optional, and safe defaults)\n");
  
  return false;
}

// Run the check
const success = checkEnvSync();
process.exit(success ? 0 : 1);