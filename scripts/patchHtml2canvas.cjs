const fs = require('fs')
const path = require('path')

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) return
  let content = fs.readFileSync(filePath, 'utf8')
  
  // Replace the throw on unsupported color functions with return COLORS.TRANSPARENT
  const colorRegex = /throw new Error\(['"]Attempting to parse an unsupported color function [^'"]+['"]\);?/g
  if (colorRegex.test(content)) {
    content = content.replace(colorRegex, 'return COLORS.TRANSPARENT;')
    fs.writeFileSync(filePath, content, 'utf8')
    console.log(`Successfully patched: ${filePath}`)
  } else if (content.includes('return COLORS.TRANSPARENT;')) {
    console.log(`Already patched: ${filePath}`)
  } else {
    console.log(`Needle not found in: ${filePath}`)
  }
}

// Patch all html2canvas entry points
patchFile('node_modules/html2canvas/dist/html2canvas.esm.js')
patchFile('node_modules/html2canvas/dist/html2canvas.js')
patchFile('node_modules/html2canvas/dist/html2canvas.min.js')

// Also patch .vite cache if present
patchFile('node_modules/.vite/deps/html2canvas.js')

// Clean .vite cache directory so Vite rebuilds prebundled deps
const viteCache = path.join('node_modules', '.vite')
if (fs.existsSync(viteCache)) {
  try {
    fs.rmSync(viteCache, { recursive: true, force: true })
    console.log('Cleared Vite cache directory: node_modules/.vite')
  } catch (err) {
    console.warn('Could not clear .vite cache:', err.message)
  }
}
