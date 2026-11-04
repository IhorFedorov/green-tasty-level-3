// Lightweight fallback for pure logic and HTTP-service specs, without a DOM.
// Component/template/browser tests still require npm run test:hw and Chrome.
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const jasmine = require('jasmine-core').boot();
const env = jasmine.getEnv();
let passed = 0;
let failed = 0;
env.configure({ random: false });
env.addReporter({
  specDone(result) {
    if (result.status === 'passed') passed++;
    if (result.status === 'failed') {
      failed++;
      console.error(result.fullName, result.failedExpectations.map(item => item.message));
    }
  },
  jasmineDone(result) {
    console.log(JSON.stringify({ scope: 'Node logic/HTTP only; no component rendering', passed, failed, status: result.overallStatus }));
    for (const error of result.failedExpectations) console.error(error.message);
    process.exitCode = result.overallStatus === 'passed' ? 0 : 1;
  },
});
const imports = [
  "import '@angular/compiler';",
  "import 'zone.js';",
  "import 'zone.js/testing';",
  "import { getTestBed, TestComponentRenderer } from '@angular/core/testing';",
  "import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';",
  'getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());',
  // Service tests never render a component; prevent DOM-only cleanup in Node.
  'beforeEach(() => getTestBed().overrideProvider(TestComponentRenderer, { useValue: { removeAllRootElements() {} } }));',
  "import './src/app/shared/helpers/date-helpers.spec.ts';",
  "import './src/app/shared/helpers/http-error-helpers.spec.ts';",
  "import './src/app/shared/helpers/consolidate-pre-order.spec.ts';",
  "import './src/app/shared/mocks/auth/demo-auth.spec.ts';",
  "import './src/app/shared/mocks/group-orders/group-orders.mock-store.spec.ts';",
  "import './src/app/services/group-orders/group-orders.service.spec.ts';",
  "import './src/app/services/group-orders/group-orders.service.sync.spec.ts';",
  "import './src/app/pages/group-order-page/group-order-page.component.logic.spec.ts';",
  "import './src/app/auth/token.owner-group.spec.ts';",
  "import './src/app/components/reservations/card-reservation/card-reservation.group-navigation.spec.ts';",
];
const built = require('esbuild').buildSync({
  stdin: { contents: imports.join('\n'), resolveDir: root, sourcefile: 'homework-node.ts', loader: 'ts' },
  absWorkingDir: root, tsconfig: path.join(root, 'tsconfig.spec.json'), bundle: true,
  write: false, platform: 'node', target: 'node24', format: 'cjs', logLevel: 'warning',
});
const compiled = new Module(path.join(root, 'homework-node-memory.cjs'), module);
compiled.filename = path.join(root, 'homework-node-memory.cjs');
compiled.paths = Module._nodeModulePaths(root);
compiled._compile(built.outputFiles[0].text, compiled.filename);
env.execute();
