const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const installSection = fs.readFileSync(
  path.join(__dirname, '..', 'build', 'installSection.nsh'),
  'utf8'
)

test('Finish Setup chạy trực tiếp ZCore.exe thay vì mở shortcut .lnk', () => {
  assert.match(
    installSection,
    /StrCpy \$launchLink "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/
  )
  assert.doesNotMatch(
    installSection,
    /StrCpy \$launchLink "\$newStartMenuLink"/
  )
})
