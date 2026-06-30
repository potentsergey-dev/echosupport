// CJS wrapper for Phusion Passenger compatibility.
// Passenger's node-loader.js uses require() which cannot load ESM modules
// with top-level await. Dynamic import() handles this correctly.
import('./dist/index.js').catch(function (err) {
  console.error('Failed to start EchoSupport:', err);
  process.exit(1);
});
