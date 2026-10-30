// Local verification adapter for Windows sandbox mkdir returning EPERM instead of
// ENOENT for missing parents. Only the explicitly selected generated build tree is affected.
// CommonJS is required here because NODE_OPTIONS --require runs before ESM loaders.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
const root = process.env.MERKAT_BUILD_OUTPUT;
const allowed = (value) =>
  root &&
  (path.resolve(String(value)) === root ||
    path.resolve(String(value)).startsWith(root + path.sep));
const original = fs.mkdir;
fs.mkdir = function (target, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  if (allowed(target)) {
    try {
      const result = fs.mkdirSync(target, { recursive: true });
      queueMicrotask(() => callback(null, result));
    } catch (error) {
      queueMicrotask(() => callback(error));
    }
    return;
  }
  return original.call(fs, target, options, callback);
};
const originalPromise = fs.promises.mkdir;
fs.promises.mkdir = async function (target, options) {
  return allowed(target)
    ? fs.mkdirSync(target, { recursive: true })
    : originalPromise.call(fs.promises, target, options);
};
