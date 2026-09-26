// PM2 on the same EC2 box as trimry-api. Generation jobs run in-process, so
// keep a single instance (no cluster mode) until they move to a queue.
module.exports = {
  apps: [
    {
      name: 'avarobe-api',
      script: 'dist/index.js',
      cwd: __dirname,
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
