const fs = require('fs')

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) return
  let content = fs.readFileSync(filePath, 'utf8')
  const needle = 'throw new Error("Attempting to parse an unsupported color function \\"" + value.name + "\\"");'
  if (content.includes(needle)) {
    content = content.replace(needle, 'return COLORS.TRANSPARENT;')
    fs.writeFileSync(filePath, content, 'utf8')
    console.log(`Successfully patched: ${filePath}`)
  } else {
    console.log(`Needle not found in: ${filePath}`)
  }
}

patchFile('node_modules/html2canvas/dist/html2canvas.esm.js')
patchFile('node_modules/html2canvas/dist/html2canvas.js')
patchFile('node_modules/html2canvas/dist/html2canvas.min.js')
