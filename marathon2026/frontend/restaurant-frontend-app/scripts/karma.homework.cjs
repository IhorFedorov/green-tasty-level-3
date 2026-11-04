const path = require('node:path');
module.exports = function (config) {
  config.set({
    basePath: path.resolve(__dirname, '..'),
    frameworks: ['jasmine'],
    plugins: [require('karma-jasmine'), require('karma-chrome-launcher')],
    reporters: ['dots'],
    hostname: '127.0.0.1',
    listenAddress: '127.0.0.1',
    browsers: ['ChromeHeadless'],
    concurrency: 1,
    singleRun: true,
    autoWatch: false,
    restartOnFileChange: false,
    client: { clearContext: true, jasmine: { random: false } },
  });
};
