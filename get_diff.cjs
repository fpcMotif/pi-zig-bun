const { execSync } = require('child_process');
const fs = require('fs');
let headBridge = execSync('git show HEAD:src/search/bridge.ts').toString();
console.log(headBridge.indexOf('appendFileSync(stderrLog, chunk)'));
