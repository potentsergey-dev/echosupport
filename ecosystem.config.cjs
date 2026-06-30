/**
 * PM2 ecosystem configuration for production deployment on hoster.by / VPS.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save
 *   pm2 startup        # generate OS-level service command
 *
 * Environment variables must be placed in .env inside the project root
 * (loaded by dotenv at app startup) or passed via the `env_production` block below.
 */
module.exports = {
  apps: [
    {
      name: 'echosupport',
      script: 'apps/backend/dist/index.js',

      // Absolute path to the project root — update for each server
      // cwd: '/home/{user}/echosupport',

      // Node.js 20 supports ESM natively; no extra flags required
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      // Log files (relative to cwd)
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      env_production: {
        NODE_ENV: 'production',
        // PORT and HOST are read from .env; override here if needed
        // PORT: 3000,
        // HOST: '127.0.0.1',
      },
    },
  ],
};
