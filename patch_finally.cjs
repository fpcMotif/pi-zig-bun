const fs = require('fs');

let testContent = fs.readFileSync('tests/extensions-loader.test.ts', 'utf8');

testContent = testContent.replace(
  '        expect(errorCalled).toBe(true);\n      } finally {\n        // no-op\n      }',
  '        expect(errorCalled).toBe(true);\n      }'
);

fs.writeFileSync('tests/extensions-loader.test.ts', testContent);
console.log('Patched tests/extensions-loader.test.ts');
