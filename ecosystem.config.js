module.exports = {
  apps: [{
    script: './build/api/api.js',
  }, {
    script: './build/api/rest.js',
  }, {
    script: './websockets.js',
  }, {
    script: './sockjs.js',
  }]
};
